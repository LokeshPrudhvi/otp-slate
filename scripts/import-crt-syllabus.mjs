import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import dotenv from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import {
  connectDatabase,
  checkProductionRole,
  scoped,
} from "../apps/api/dist/database.js";
import { crtTopicInput } from "../apps/api/dist/crt.js";
import * as s from "../apps/api/dist/schema.js";

const manifestPath = new URL(
  "../data/crt/campus-recruitment-aptitude-training.json",
  import.meta.url,
);
const key = (subject, title) =>
  `${subject}:${title.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()}`;
const ordered = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

function topicId(importId, topic) {
  const namespace = Buffer.from("9a584df30ee64e8ba86ed02b8648ebc6", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(`${importId}:${key(topic.subjectId, topic.title)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// An additive content import, never a seed/reset: existing topics and all
// publication, assignment, upload and attempt records remain untouched.
export async function importCrtSyllabus(
  db,
  manifest,
  { apply = false, actorId } = {},
) {
  assert.equal(manifest.source.kind, "syllabus-only");
  assert.match(manifest.source.sha256, /^[a-f0-9]{64}$/);
  assert.ok(
    manifest.id && manifest.topics.length > 0 && manifest.topics.length <= 1000,
  );
  const drafts = manifest.topics.map((topic) => {
    assert.ok(topic.title.length <= 150);
    assert.ok(
      topic.sourcePage >= 1 && topic.sourcePage <= manifest.source.pageCount,
    );
    const section = [topic.sourceSubject, topic.group]
      .filter(Boolean)
      .join(" / ");
    return {
      id: topicId(manifest.id, topic),
      draft: crtTopicInput.parse({
        title: topic.title,
        subjectId: topic.subjectId,
        description: `${section}. Curriculum topic from the Campus Recruitment - Aptitude Training syllabus (page ${topic.sourcePage}).`,
        passingScore: manifest.defaultPassingScore,
        questions: [],
      }),
    };
  });
  assert.equal(
    new Set(drafts.map((row) => row.id)).size,
    drafts.length,
    "Duplicate source topic",
  );
  return scoped(db, { platform: true }, async (tx) => {
    // Serialize repeats of this import, including invocations from another CLI.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`crt-syllabus:${manifest.id}`}, 0))`,
    );
    const admins = await tx
      .select()
      .from(s.members)
      .where(
        and(
          eq(s.members.role, "platform_admin"),
          eq(s.members.status, "active"),
        ),
      );
    const actor = actorId
      ? admins.find((row) => row.id === actorId)
      : admins.length === 1
        ? admins[0]
        : null;
    assert.ok(
      actor,
      "Select one existing active platform admin with --actor-id",
    );
    const before = await tx.select().from(s.crtTopics);
    const existingIds = new Set(before.map((row) => row.id));
    const preservedTables = {
      versions: s.crtVersions,
      assignments: s.crtAssignments,
      attempts: s.crtAttempts,
      bank: s.crtBank,
      uploads: s.lessonUploads,
    };
    const snapshots = {};
    for (const [name, table] of Object.entries(preservedTables))
      snapshots[name] = ordered(await tx.select().from(table));
    const planned = [],
      skipped = [];
    for (const item of drafts) {
      const idMatch = before.find((row) => row.id === item.id);
      const titleMatches = before.filter(
        (row) =>
          key(row.draft.subjectId, row.draft.title) ===
          key(item.draft.subjectId, item.draft.title),
      );
      assert.ok(
        idMatch || titleMatches.length <= 1,
        `Ambiguous existing topic: ${item.draft.title}`,
      );
      const existing = idMatch || titleMatches[0];
      if (existing)
        skipped.push({
          id: existing.id,
          title: item.draft.title,
          reason: idMatch ? "previously-imported" : "existing-title",
        });
      else
        planned.push({
          ...item,
          createdBy: actor.id,
          status: "draft",
          revision: 1,
        });
    }
    if (apply && planned.length) {
      const inserted = await tx.insert(s.crtTopics).values(planned).returning();
      assert.equal(inserted.length, planned.length);
      assert.ok(
        inserted.every(
          (row) =>
            row.status === "draft" &&
            !row.draft.pdfUploadId &&
            row.draft.questions.length === 0,
        ),
      );
      await tx.insert(s.audit).values({
        actorId: actor.id,
        action: "crt.curriculum.imported",
        resourceId: manifest.id,
        details: {
          source: manifest.source,
          topicIds: inserted.map((row) => row.id),
          created: inserted.length,
          skipped: skipped.length,
          defaultPassingScore: manifest.defaultPassingScore,
        },
      });
      const after = await tx.select().from(s.crtTopics);
      assert.deepEqual(
        ordered(after.filter((row) => existingIds.has(row.id))),
        ordered(before),
      );
      assert.equal(after.length, before.length + planned.length);
      for (const [name, table] of Object.entries(preservedTables))
        assert.deepEqual(
          ordered(await tx.select().from(table)),
          snapshots[name],
          `${name} must remain unchanged`,
        );
    }
    return {
      importId: manifest.id,
      applied: apply,
      sourceTopics: drafts.length,
      created: apply ? planned.length : 0,
      wouldCreate: apply ? 0 : planned.length,
      skipped,
      bySubject: Object.fromEntries(
        ["quantitative", "reasoning", "verbal", "soft-skills"].map((id) => [
          id,
          drafts.filter((row) => row.draft.subjectId === id).length,
        ]),
      ),
      existingTopicCount: before.length,
      preservedCounts: Object.fromEntries(
        Object.entries(snapshots).map(([name, rows]) => [name, rows.length]),
      ),
      topicIds: [
        ...planned.map((row) => row.id),
        ...skipped.map((row) => row.id),
      ],
    };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      env: { type: "string" },
      "expected-host": { type: "string" },
      "actor-id": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  assert.ok(
    values.env && values["expected-host"],
    "Usage: node scripts/import-crt-syllabus.mjs --env <private-env-file> --expected-host <database-host> [--actor-id <uuid>] [--apply]",
  );
  const env = dotenv.parse(readFileSync(values.env));
  const url = new URL(env.DATABASE_URL);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.equal(
    url.hostname,
    values["expected-host"],
    "Configured database does not match the intended target",
  );
  url.searchParams.set("sslmode", "verify-full");
  const connection = await connectDatabase(url.href);
  try {
    await checkProductionRole(connection.db);
    const result = await importCrtSyllabus(
      connection.db,
      JSON.parse(readFileSync(manifestPath, "utf8")),
      { apply: values.apply, actorId: values["actor-id"] },
    );
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
    // Never echo driver messages or environment values containing credentials.
    console.error(
      JSON.stringify({
        failed: true,
        code: error.code || error.name,
        ...(error.code === "ERR_ASSERTION" ? { reason: error.message } : {}),
      }),
    );
    process.exitCode = 1;
  });
}
