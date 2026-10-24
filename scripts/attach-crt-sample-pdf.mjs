import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  checkProductionRole,
  connectDatabase,
  scoped,
} from "../apps/api/dist/database.js";
import { crtTopicInput } from "../apps/api/dist/crt.js";
import * as s from "../apps/api/dist/schema.js";

// Reuse one completed private upload and optionally add approved starter MCQs
// to empty drafts. Never publish, change grants, or replace PDFs/questions.
export async function attachCrtSamplePdf(
  db,
  { actorId, pdfUploadId, apply = false, starterTopics = [] } = {},
) {
  z.uuid().parse(actorId);
  z.uuid().parse(pdfUploadId);
  z.boolean().parse(apply);
  const starters = z
    .array(
      z
        .object({
          topicId: z.uuid(),
          title: z.string().min(1),
          subjectId: z.string().min(1),
          questions: z.array(z.unknown()).min(1),
        })
        .strict(),
    )
    .parse(starterTopics);
  assert.equal(
    new Set(starters.map((topic) => topic.topicId)).size,
    starters.length,
    "Supply each starter topic once.",
  );
  return scoped(db, { platform: true }, async (tx) => {
    const [actor] = await tx
      .select({ id: s.members.id })
      .from(s.members)
      .where(
        and(
          eq(s.members.id, actorId),
          eq(s.members.role, "platform_admin"),
          eq(s.members.status, "active"),
        ),
      );
    assert.ok(actor, "Select an existing active platform admin.");
    const [upload] = await tx
      .select()
      .from(s.lessonUploads)
      .where(eq(s.lessonUploads.id, pdfUploadId));
    assert.ok(
      upload &&
        upload.purpose === "crt_pdf" &&
        upload.status === "ready" &&
        upload.objectKey &&
        upload.contentType === "application/pdf" &&
        upload.size > 0 &&
        upload.size <= 20 * 1024 * 1024,
      "Select a completed private CRT PDF upload of at most 20 MB.",
    );
    const query = tx.select().from(s.crtTopics);
    // Locks and a revision check prevent concurrent edits from being replaced.
    const topics = await (apply ? query.for("update") : query);
    for (const starter of starters) {
      const topic = topics.find((topic) => topic.id === starter.topicId);
      assert.ok(
        topic &&
          topic.draft.title === starter.title &&
          topic.draft.subjectId === starter.subjectId,
        "Starter questions must match the exact existing topic identity.",
      );
      crtTopicInput.parse({ ...topic.draft, questions: starter.questions });
      assert.ok(
        starter.questions.every(
          (question) =>
            question.prompt.trim() &&
            question.options.every((option) => option.trim()) &&
            Number.isInteger(question.correctOption) &&
            question.correctOption >= 0 &&
            question.correctOption < question.options.length,
        ),
        "Complete each starter MCQ and select a correct answer.",
      );
    }
    const changes = topics.flatMap((topic) => {
      if (topic.status !== "draft") return [];
      const attachPdf = !Object.hasOwn(topic.draft, "pdfUploadId");
      const starter = starters.find((item) => item.topicId === topic.id);
      const addQuestions = Boolean(
        starter && topic.draft.questions.length === 0,
      );
      if (!attachPdf && !addQuestions) return [];
      const draft = {
        ...topic.draft,
        ...(attachPdf ? { pdfUploadId } : {}),
        ...(addQuestions ? { questions: starter.questions } : {}),
      };
      // Validate without normalizing existing text or question content.
      crtTopicInput.parse(draft);
      return [{ topic, draft, attachPdf, addQuestions }];
    });
    if (apply && changes.length) {
      for (const { topic, draft } of changes) {
        const changed = await tx
          .update(s.crtTopics)
          .set({
            draft,
            revision: topic.revision + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(s.crtTopics.status, "draft"),
              eq(s.crtTopics.id, topic.id),
              eq(s.crtTopics.revision, topic.revision),
            ),
          )
          .returning({ id: s.crtTopics.id });
        assert.equal(
          changed.length,
          1,
          "A CRT draft changed; retry the operation.",
        );
      }
      await tx.insert(s.audit).values({
        actorId,
        action: "crt.sample_pdf.attached",
        resourceId: pdfUploadId,
        details: {
          topicIds: changes.map(({ topic }) => topic.id),
          attached: changes.filter((change) => change.attachPdf).length,
          questionsAdded: changes.filter((change) => change.addQuestions)
            .length,
        },
      });
    }
    return {
      applied: apply,
      pdfUploadId,
      attached: apply ? changes.filter((change) => change.attachPdf).length : 0,
      wouldAttach: apply
        ? 0
        : changes.filter((change) => change.attachPdf).length,
      questionsAdded: apply
        ? changes.filter((change) => change.addQuestions).length
        : 0,
      wouldAddQuestions: apply
        ? 0
        : changes.filter((change) => change.addQuestions).length,
      topicIds: changes.map(({ topic }) => topic.id),
      withoutQuestions: changes.filter(({ draft }) => !draft.questions.length)
        .length,
      published: 0,
    };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      "expected-host": { type: "string" },
      "actor-id": { type: "string" },
      "upload-id": { type: "string" },
      "starter-file": { type: "string", multiple: true },
      apply: { type: "boolean", default: false },
    },
  });
  assert.ok(
    values.env &&
      values["expected-host"] &&
      values["actor-id"] &&
      values["upload-id"],
    "Usage: node scripts/attach-crt-sample-pdf.mjs --env <private-env-file> --expected-host <direct-database-host> --actor-id <uuid> --upload-id <uuid> [--apply]",
  );
  const env = dotenv.parse(readFileSync(values.env));
  const url = new URL(env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  // Keep the configured runtime principal; use its direct Neon endpoint.
  if (url.hostname.endsWith(".neon.tech"))
    url.hostname = url.hostname.replace(/-pooler(?=\.)/, "");
  assert.equal(
    url.hostname,
    values["expected-host"],
    "Configured database does not match the intended target",
  );
  url.searchParams.set("sslmode", "verify-full");
  const connection = await connectDatabase(url.href);
  try {
    await checkProductionRole(connection.db);
    const result = await attachCrtSamplePdf(connection.db, {
      actorId: values["actor-id"],
      pdfUploadId: values["upload-id"],
      apply: values.apply,
      starterTopics: (values["starter-file"] || []).flatMap((file) => {
        const content = JSON.parse(readFileSync(file, "utf8"));
        return Array.isArray(content) ? content : content.topics;
      }),
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await connection.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    // Driver errors can include connection data; print only a safe classifier.
    console.error(
      JSON.stringify({ failed: true, code: error.code || error.name }),
    );
    process.exitCode = 1;
  });
}
