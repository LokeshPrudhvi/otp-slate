import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  connectDatabase,
  migrateDatabase,
  scoped,
} from "../apps/api/dist/database.js";
import * as s from "../apps/api/dist/schema.js";
import { attachCrtSamplePdf } from "../scripts/attach-crt-sample-pdf.mjs";

test("sample CRT PDF attachment is additive, explicit, idempotent and preserves learning history", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  t.after(() => connection.close());
  await migrateDatabase(connection.db);
  const scope = (work) => scoped(connection.db, { platform: true }, work);
  const question = {
    id: "percentages-1",
    prompt: "What is 20% of 50?",
    options: ["10", "20", "25", "40"],
    correctOption: 0,
    explanation: "50 × 20 / 100 = 10.",
  };
  const fixture = await scope(async (tx) => {
    const [organization] = await tx
      .insert(s.organizations)
      .values({ name: "Isolated CRT test" })
      .returning();
    const users = await tx
      .insert(s.user)
      .values([
        { id: randomUUID(), name: "Admin", email: "admin@crt-sample.invalid" },
        {
          id: randomUUID(),
          name: "Student",
          email: "student@crt-sample.invalid",
        },
      ])
      .returning();
    const [admin, student] = await tx
      .insert(s.members)
      .values([
        { authUserId: users[0].id, role: "platform_admin" },
        {
          authUserId: users[1].id,
          role: "student",
          organizationId: organization.id,
        },
      ])
      .returning();
    const upload = (name, overrides = {}) => ({
      ownerId: admin.id,
      purpose: "crt_pdf",
      fileName: `${name}.pdf`,
      contentType: "application/pdf",
      size: 1024,
      stagingKey: `staging/${name}`,
      objectKey: `ready/${name}`,
      status: "ready",
      ...overrides,
    });
    const [sample, original, pending, wrongType, oversize] = await tx
      .insert(s.lessonUploads)
      .values([
        upload("sample"),
        upload("original"),
        upload("pending", { status: "pending", objectKey: null }),
        upload("image", {
          purpose: "question_image",
          fileName: "image.png",
          contentType: "image/png",
        }),
        upload("oversize", { size: 21 * 1024 * 1024 }),
      ])
      .returning();
    const draft = (title, overrides = {}) => ({
      title,
      subjectId: "quantitative",
      description: "Keep this description.",
      passingScore: 70,
      questions: [],
      ...overrides,
    });
    const [empty, assessed, existing, published, missingPublished] = await tx
      .insert(s.crtTopics)
      .values([
        { draft: draft("No questions yet"), createdBy: admin.id },
        {
          draft: draft("Existing MCQs", { questions: [question] }),
          createdBy: admin.id,
          revision: 4,
        },
        {
          draft: draft("Keep original PDF", {
            pdfUploadId: original.id,
            questions: [question],
          }),
          createdBy: admin.id,
        },
        {
          draft: draft("Published", {
            pdfUploadId: original.id,
            questions: [question],
          }),
          createdBy: admin.id,
          status: "published",
        },
        {
          draft: draft("Published without PDF"),
          createdBy: admin.id,
          status: "published",
        },
      ])
      .returning();
    const [version] = await tx
      .insert(s.crtVersions)
      .values({
        topicId: published.id,
        number: 1,
        content: {
          ...published.draft,
          pdf: {
            id: original.id,
            fileName: original.fileName,
            contentType: original.contentType,
            size: original.size,
          },
        },
      })
      .returning();
    await tx
      .insert(s.crtAssignments)
      .values({
        organizationId: organization.id,
        branchId: null,
        topicId: published.id,
        versionId: version.id,
      });
    await tx
      .insert(s.crtAttempts)
      .values({
        clientId: randomUUID(),
        organizationId: organization.id,
        memberId: student.id,
        kind: "topic",
        topicId: published.id,
        versionId: version.id,
        questions: [question],
        passingScore: 70,
        readAcknowledged: true,
        answers: { [question.id]: 0 },
        result: { score: 100, passed: true },
        submittedAt: new Date(),
      });
    await tx.insert(s.crtBank).values({ topicId: published.id, question });
    const [course] = await tx
      .insert(s.courses)
      .values({
        title: "Existing course",
        description: "Retain access",
        track: "foundation",
      })
      .returning();
    const [courseVersion] = await tx
      .insert(s.versions)
      .values({
        courseId: course.id,
        number: 1,
        title: course.title,
        description: course.description,
        lessons: [],
      })
      .returning();
    await tx
      .insert(s.grants)
      .values({
        organizationId: organization.id,
        memberId: student.id,
        courseId: course.id,
        versionId: courseVersion.id,
      });
    await tx
      .insert(s.progress)
      .values({
        organizationId: organization.id,
        memberId: student.id,
        versionId: courseVersion.id,
        lessonId: "retain-completed-lesson",
      });
    return {
      admin,
      student,
      sample,
      original,
      pending,
      wrongType,
      oversize,
      empty,
      assessed,
      existing,
      published,
      missingPublished,
    };
  });
  const snapshot = () =>
    scope(async (tx) => {
      const result = {};
      for (const [name, table] of Object.entries({
        topics: s.crtTopics,
        versions: s.crtVersions,
        assignments: s.crtAssignments,
        attempts: s.crtAttempts,
        bank: s.crtBank,
        uploads: s.lessonUploads,
        grants: s.grants,
        progress: s.progress,
        members: s.members,
        audit: s.audit,
      }))
        result[name] = (await tx.select().from(table)).sort((a, b) =>
          a.id.localeCompare(b.id),
        );
      return result;
    });
  const before = await snapshot();
  const input = { actorId: fixture.admin.id, pdfUploadId: fixture.sample.id };

  await t.test(
    "default dry run writes no topics, audit, assets or history",
    async () => {
      const result = await attachCrtSamplePdf(connection.db, input);
      assert.equal(result.applied, false);
      assert.equal(result.attached, 0);
      assert.equal(result.wouldAttach, 2);
      assert.equal(result.withoutQuestions, 1);
      assert.deepEqual(await snapshot(), before);
    },
  );

  await t.test(
    "rejects a non-admin and unfinished or invalid PDF without changes",
    async () => {
      await assert.rejects(
        () =>
          attachCrtSamplePdf(connection.db, {
            ...input,
            actorId: fixture.student.id,
            apply: true,
          }),
        /active platform admin/,
      );
      for (const upload of [
        fixture.pending,
        fixture.wrongType,
        fixture.oversize,
      ])
        await assert.rejects(
          () =>
            attachCrtSamplePdf(connection.db, {
              ...input,
              pdfUploadId: upload.id,
              apply: true,
            }),
          /completed private CRT PDF/,
        );
      assert.deepEqual(await snapshot(), before);
    },
  );

  await t.test(
    "only missing draft PDFs change; existing questions and all access/progress remain intact",
    async () => {
      const result = await attachCrtSamplePdf(connection.db, {
        ...input,
        apply: true,
      });
      assert.equal(result.attached, 2);
      assert.equal(result.published, 0);
      assert.deepEqual(
        new Set(result.topicIds),
        new Set([fixture.empty.id, fixture.assessed.id]),
      );
      const after = await snapshot();
      for (const key of Object.keys(before).filter(
        (key) => !["topics", "audit"].includes(key),
      ))
        assert.deepEqual(after[key], before[key], `${key} remains unchanged`);
      for (const original of before.topics) {
        const changed = after.topics.find((topic) => topic.id === original.id);
        if (result.topicIds.includes(original.id)) {
          assert.deepEqual(changed.draft, {
            ...original.draft,
            pdfUploadId: fixture.sample.id,
          });
          assert.equal(changed.revision, original.revision + 1);
          assert.equal(changed.status, "draft");
          assert.deepEqual(
            {
              ...changed,
              draft: original.draft,
              revision: original.revision,
              updatedAt: original.updatedAt,
            },
            original,
          );
        } else assert.deepEqual(changed, original);
      }
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.audit[0].action, "crt.sample_pdf.attached");
      assert.equal(after.audit[0].details.attached, 2);
    },
  );

  await t.test("repeat application and dry run are no-ops", async () => {
    const after = await snapshot();
    const repeated = await attachCrtSamplePdf(connection.db, {
      ...input,
      apply: true,
    });
    const preview = await attachCrtSamplePdf(connection.db, input);
    assert.equal(repeated.attached, 0);
    assert.equal(preview.wouldAttach, 0);
    assert.deepEqual(await snapshot(), after);
  });

  await t.test(
    "optional starter questions require exact identities and only fill empty drafts",
    async () => {
      const beforeStarters = await snapshot();
      const starterQuestion = {
        ...question,
        id: "approved-starter-1",
        prompt: "What is 10% of 100?",
      };
      const starterTopics = [
        fixture.empty,
        fixture.assessed,
        fixture.published,
      ].map((topic) => ({
        topicId: topic.id,
        title: topic.draft.title,
        subjectId: topic.draft.subjectId,
        questions: [starterQuestion],
      }));
      await assert.rejects(
        () =>
          attachCrtSamplePdf(connection.db, {
            ...input,
            apply: true,
            starterTopics: [{ ...starterTopics[0], title: "Incorrect match" }],
          }),
        /exact existing topic identity/,
      );
      await assert.rejects(
        () =>
          attachCrtSamplePdf(connection.db, {
            ...input,
            apply: true,
            starterTopics: [
              {
                ...starterTopics[0],
                questions: [{ ...starterQuestion, correctOption: undefined }],
              },
            ],
          }),
        /select a correct answer/,
      );
      assert.deepEqual(await snapshot(), beforeStarters);
      const preview = await attachCrtSamplePdf(connection.db, {
        ...input,
        starterTopics,
      });
      assert.equal(preview.wouldAttach, 0);
      assert.equal(preview.wouldAddQuestions, 1);
      assert.deepEqual(await snapshot(), beforeStarters);
      const applied = await attachCrtSamplePdf(connection.db, {
        ...input,
        starterTopics,
        apply: true,
      });
      assert.equal(applied.attached, 0);
      assert.equal(applied.questionsAdded, 1);
      assert.deepEqual(applied.topicIds, [fixture.empty.id]);
      const afterStarters = await snapshot();
      for (const key of Object.keys(beforeStarters).filter(
        (key) => !["topics", "audit"].includes(key),
      ))
        assert.deepEqual(afterStarters[key], beforeStarters[key]);
      for (const original of beforeStarters.topics) {
        const changed = afterStarters.topics.find(
          (topic) => topic.id === original.id,
        );
        if (original.id === fixture.empty.id) {
          assert.deepEqual(changed.draft, {
            ...original.draft,
            questions: [starterQuestion],
          });
          assert.equal(changed.revision, original.revision + 1);
          assert.equal(changed.status, "draft");
        } else assert.deepEqual(changed, original);
      }
      const repeated = await attachCrtSamplePdf(connection.db, {
        ...input,
        starterTopics,
        apply: true,
      });
      assert.equal(repeated.questionsAdded, 0);
      assert.deepEqual(await snapshot(), afterStarters);
    },
  );
});
