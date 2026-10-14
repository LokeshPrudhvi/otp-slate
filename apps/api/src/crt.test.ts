import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { createAuth } from "./auth.js";
import { SlateService, type Actor } from "./service.js";
import { CrtService, crtSubmitInput, crtTopicInput } from "./crt.js";
import { LessonService } from "./lessons.js";
import type { LessonStorage } from "./lesson-storage.js";
import type { CrtTopicDraft } from "@slate/contracts";
import * as s from "./schema.js";

test("CRT curriculum stays branch scoped, versioned, private and persistently graded", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "crt-test-only-secret-at-least-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const objects = new Map<
    string,
    { size: number; contentType: string; bytes: Uint8Array }
  >();
  let bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");
  const storage: LessonStorage = {
    configured: () => true,
    async upload(key, contentType, size) {
      objects.set(key, { size, contentType, bytes });
      return `https://private.invalid/upload/${key}`;
    },
    async head(key) {
      return objects.get(key)!;
    },
    async finalize(from, to) {
      objects.set(to, objects.get(from)!);
    },
    async readPrefix(key, length) {
      return objects.get(key)!.bytes.slice(0, length);
    },
    async download(key) {
      return `https://private.invalid/${key}`;
    },
  };
  const service = new SlateService(
    connection.db,
    auth,
    config,
    {
      configured: false,
      async send() {
        assert.fail("No external messages");
      },
    },
    true,
    storage,
  );
  const crt = new CrtService(service),
    lessons = new LessonService(service, storage);
  const [org, other] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "CRT College" }, { name: "Other CRT College" }])
      .returning(),
  );
  const branches = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizationBranches)
      .values([
        { organizationId: org.id, code: "CSE", name: "Computer Science" },
        { organizationId: org.id, code: "ME", name: "Mechanical" },
        { organizationId: other.id, code: "CSE", name: "Computer Science" },
      ])
      .returning(),
  );
  async function person(
    name: string,
    role: Actor["role"],
    organizationId: string | null,
    branchCode = "CSE",
  ): Promise<Actor> {
    const id = randomUUID();
    await scoped(connection.db, { platform: true }, (tx) =>
      tx.insert(s.user).values({ id, name, email: `${name}@crt.invalid` }),
    );
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: id,
          organizationId,
          role,
          branchCode: organizationId ? branchCode : null,
          branchName: organizationId ? branchCode : null,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    return {
      id: member.id,
      authId: id,
      sessionId: "test",
      name,
      email: `${name}@crt.invalid`,
      role,
      organizationId,
      organizationName: organizationId ? "College" : null,
      onboardingStep: null,
      features: ["crt"],
    };
  }
  const admin = await person("admin", "platform_admin", null),
    student = await person("learner", "student", org.id),
    peer = await person("peer", "student", org.id),
    mechanical = await person("mechanical", "student", org.id, "ME"),
    otherStudent = await person("other", "student", other.id),
    viewer = await person("viewer", "organization_viewer", org.id);
  let pdfId = "",
    imageId = "";
  await t.test(
    "PDF uploads require admin, PDF type, size and actual bytes",
    async () => {
      await assert.rejects(() =>
        lessons.createUpload(student, {
          purpose: "crt_pdf",
          fileName: "lesson.pdf",
          contentType: "application/pdf",
          size: 14,
        }),
      );
      await assert.rejects(() =>
        lessons.createUpload(admin, {
          purpose: "crt_pdf",
          fileName: "lesson.txt",
          contentType: "text/plain",
          size: 14,
        }),
      );
      await assert.rejects(() =>
        lessons.createUpload(admin, {
          purpose: "crt_pdf",
          fileName: "lesson.pdf",
          contentType: "application/pdf",
          size: 21 * 1024 * 1024,
        }),
      );
      bytes = new TextEncoder().encode("not a pdf");
      const bad = await lessons.createUpload(admin, {
        purpose: "crt_pdf",
        fileName: "bad.pdf",
        contentType: "application/pdf",
        size: bytes.length,
      });
      await assert.rejects(() => lessons.completeUpload(admin, bad.upload.id));
      bytes = new TextEncoder().encode("%PDF-1.7\n%%EOF");
      const good = await lessons.createUpload(admin, {
        purpose: "crt_pdf",
        fileName: "ratios.pdf",
        contentType: "application/pdf",
        size: bytes.length,
      });
      pdfId = (await lessons.completeUpload(admin, good.upload.id)).id;
      bytes = Uint8Array.from([
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      const image = await lessons.createUpload(admin, {
        purpose: "question_image",
        fileName: "diagram.png",
        contentType: "image/png",
        size: bytes.length,
      });
      imageId = (await lessons.completeUpload(admin, image.upload.id)).id;
    },
  );
  const draft: CrtTopicDraft = {
    title: "Ratios",
    subjectId: "quantitative",
    description: "Read the PDF and solve the problems.",
    passingScore: 67,
    pdfUploadId: pdfId,
    questions: [
      {
        id: "q1",
        prompt: "One plus one?",
        options: ["2", "3"],
        correctOption: 0,
        explanation: "Add the numbers.",
        image: { uploadId: imageId, alt: "Two counters" },
      },
      {
        id: "q2",
        prompt: "Two plus two?",
        options: ["4", "5"],
        correctOption: 0,
      },
      {
        id: "q3",
        prompt: "Three plus three?",
        options: ["6", "7"],
        correctOption: 0,
      },
    ],
  };
  let topic = await crt.create(admin, draft);
  await t.test(
    "drafts may be incomplete; publish validates and is optimistic",
    async () => {
      const incomplete = await crt.create(admin, {
        ...draft,
        title: "Incomplete",
        pdfUploadId: undefined,
        questions: [{ id: "blank", prompt: "", options: ["", ""] }],
      });
      await assert.rejects(() =>
        crt.publish(admin, incomplete.id, incomplete.revision),
      );
      await assert.rejects(() => crt.publish(admin, topic.id, 99));
      assert.equal(
        crtTopicInput.safeParse({
          ...draft,
          questions: [draft.questions[0], draft.questions[0]],
        }).success,
        false,
      );
      topic = await crt.publish(admin, topic.id, topic.revision);
      assert.equal(topic.version, 1);
      assert.ok(topic.versionId);
      await assert.rejects(() => crt.publish(admin, topic.id, topic.revision));
    },
  );
  await t.test(
    "one organization and stable branch are required, even with identical branch codes",
    async () => {
      await assert.rejects(() =>
        crt.assign(admin, {
          organizationId: org.id,
          branchId: branches[2].id,
          topics: [{ topicId: topic.id, versionId: topic.versionId! }],
        }),
      );
      await crt.assign(admin, {
        organizationId: org.id,
        branchId: branches[0].id,
        topics: [{ topicId: topic.id, versionId: topic.versionId! }],
      });
      const revisions = await scoped(connection.db, { platform: true }, (tx) =>
        tx
          .select({
            id: s.organizations.id,
            revision: s.organizations.accessRevision,
          })
          .from(s.organizations),
      );
      assert.equal(
        revisions.find((row) => row.id === org.id)!.revision,
        org.accessRevision + 1,
      );
      assert.equal(
        revisions.find((row) => row.id === other.id)!.revision,
        other.accessRevision,
      );
      assert.equal((await crt.studentList(student)).length, 1);
      assert.equal((await crt.studentList(mechanical)).length, 0);
      assert.equal((await crt.studentList(otherStudent)).length, 0);
      await assert.rejects(() => crt.studentDetail(otherStudent, topic.id));
      await assert.rejects(() => crt.studentDetail(mechanical, topic.id));
      await assert.rejects(() => crt.studentList(viewer));
      const cross = await service.scope(otherStudent, (tx) =>
        tx.select().from(s.crtVersions),
      );
      assert.equal(cross.length, 0);
      const assigned = await crt.studentDetail(student, topic.id);
      assert.equal(assigned.questions[0].correctOption, undefined);
      assert.equal(assigned.questions[0].explanation, undefined);
      await assert.rejects(() => lessons.download(student, pdfId));
      await assert.rejects(() => crt.pdf(otherStudent, topic.id));
      assert.match((await crt.pdf(student, topic.id)).url, /private.invalid/);
      await assert.rejects(() =>
        crt.topicImage(otherStudent, topic.id, imageId),
      );
      await assert.rejects(() =>
        crt.topicImage(student, topic.id, randomUUID()),
      );
      assert.match(
        (await crt.topicImage(student, topic.id, imageId)).url,
        /private.invalid/,
      );
    },
  );
  await t.test(
    "chosen percentage, reading acknowledgment, retries and idempotency are enforced",
    async () => {
      assert.equal(
        crtSubmitInput.safeParse({
          versionId: topic.versionId,
          clientId: randomUUID(),
          answers: { q1: 0, q2: 0, q3: 0 },
          readAcknowledged: false,
        }).success,
        false,
      );
      await assert.rejects(() =>
        crt.submit(student, topic.id, {
          versionId: topic.versionId!,
          clientId: randomUUID(),
          answers: { q1: 0 },
          readAcknowledged: true,
        }),
      );
      const first = {
        versionId: topic.versionId!,
        clientId: randomUUID(),
        answers: { q1: 0, q2: 0, q3: 1 },
        readAcknowledged: true as const,
      };
      const fail = await crt.submit(student, topic.id, first);
      assert.equal(fail.score, 66.67);
      assert.equal(fail.passed, false);
      assert.equal(fail.questions[0].correctOption, 0);
      const repeated = await crt.submit(student, topic.id, {
        ...first,
        answers: { q1: 0, q2: 0, q3: 0 },
      });
      assert.deepEqual(repeated, fail);
      const pass = await crt.submit(student, topic.id, {
        ...first,
        clientId: randomUUID(),
        answers: { q1: 0, q2: 0, q3: 0 },
      });
      assert.equal(pass.passed, true);
      await crt.submit(student, topic.id, {
        ...first,
        clientId: randomUUID(),
        answers: { q1: 1, q2: 1, q3: 1 },
      });
      assert.equal(
        (await crt.studentDetail(student, topic.id)).completed,
        true,
      );
      assert.equal((await crt.studentDetail(student, topic.id)).bestScore, 100);
      assert.equal((await crt.studentDetail(peer, topic.id)).completed, false);
    },
  );
  await t.test(
    "new versions do not alter assigned content or previous progress",
    async () => {
      const oldVersion = topic.versionId!;
      topic = await crt.update(admin, topic.id, {
        ...draft,
        title: "Ratios revised",
        passingScore: 50,
        revision: topic.revision,
      });
      topic = await crt.publish(admin, topic.id, topic.revision);
      assert.equal(topic.version, 2);
      assert.equal(
        (await crt.studentDetail(student, topic.id)).versionId,
        oldVersion,
      );
      assert.equal(
        (await crt.studentDetail(student, topic.id)).completed,
        true,
      );
      await crt.assign(admin, {
        organizationId: org.id,
        branchId: branches[0].id,
        topics: [{ topicId: topic.id, versionId: topic.versionId! }],
      });
      assert.equal(
        (await crt.studentDetail(student, topic.id)).completed,
        false,
      );
      await assert.rejects(() =>
        crt.submit(student, topic.id, {
          versionId: oldVersion,
          clientId: randomUUID(),
          answers: { q1: 0, q2: 0, q3: 0 },
          readAcknowledged: true,
        }),
      );
      const passed = await crt.submit(student, topic.id, {
        versionId: topic.versionId!,
        clientId: randomUUID(),
        answers: { q1: 0, q2: 0, q3: 1 },
        readAcknowledged: true,
      });
      assert.equal(passed.passed, true);
      const old = await service.scope(student, (tx) =>
        tx
          .select()
          .from(s.crtAttempts)
          .where(eq(s.crtAttempts.versionId, oldVersion)),
      );
      assert.equal(old.length, 3);
      await assert.rejects(() =>
        service.scope(admin, (tx) =>
          tx
            .update(s.crtVersions)
            .set({ number: 99 })
            .where(eq(s.crtVersions.id, oldVersion)),
        ),
      );
    },
  );
  await t.test(
    "branch rename preserves assignment identity and student completion",
    async () => {
      await scoped(connection.db, { platform: true }, async (tx) => {
        await tx
          .update(s.organizationBranches)
          .set({ code: "CST", name: "Computing" })
          .where(eq(s.organizationBranches.id, branches[0].id));
        await tx
          .update(s.members)
          .set({ branchCode: "CST", branchName: "Computing" })
          .where(
            and(
              eq(s.members.organizationId, org.id),
              eq(s.members.branchCode, "CSE"),
            ),
          );
      });
      assert.equal(
        (await crt.studentDetail(student, topic.id)).completed,
        true,
      );
      assert.equal((await crt.studentList(otherStudent)).length, 0);
    },
  );
  await t.test(
    "practice mixes assigned topic and extra questions, snapshots answers, never completes a topic",
    async () => {
      const extra = await crt.createBank(admin, topic.id, {
        question: {
          id: "bank-one",
          prompt: "Extra question",
          options: ["Correct", "Wrong"],
          correctOption: 0,
        },
      });
      const practice = await crt.practice(peer, {
        subjectId: "quantitative",
        topicIds: [topic.id],
        count: 10,
      });
      assert.equal(practice.questions.length, 4);
      assert.equal(
        practice.questions.filter((q) => q.prompt === "Extra question").length,
        1,
      );
      assert.equal(new Set(practice.questions.map((q) => q.id)).size, 4);
      assert.equal(practice.questions[0].correctOption, undefined);
      assert.equal(practice.result, null);
      await assert.rejects(() =>
        crt.practice(otherStudent, { topicIds: [topic.id], count: 10 }),
      );
      await assert.rejects(() =>
        crt.practice(peer, {
          subjectId: "verbal",
          topicIds: [topic.id],
          count: 10,
        }),
      );
      await assert.rejects(() => crt.practiceSession(student, practice.id));
      await crt.updateBank(admin, extra.id, {
        question: { ...extra.question, correctOption: 1 },
        revision: extra.revision,
        active: false,
      });
      const result = await crt.submitPractice(peer, practice.id, {
        answers: Object.fromEntries(practice.questions.map((q) => [q.id, 0])),
      });
      assert.equal(result.score, 100);
      assert.equal((await crt.studentDetail(peer, topic.id)).completed, false);
      assert.deepEqual(
        (await crt.practiceSession(peer, practice.id)).result,
        result,
      );
      assert.deepEqual(
        await crt.submitPractice(peer, practice.id, { answers: {} }),
        result,
      );
      assert.equal(
        (await crt.practice(peer, { count: 10 })).questions.length,
        3,
      );
      await assert.rejects(() =>
        crt.practiceImage(otherStudent, practice.id, imageId),
      );
      assert.match(
        (await crt.practiceImage(peer, practice.id, imageId)).url,
        /private.invalid/,
      );
      await crt.assign(admin, {
        organizationId: org.id,
        branchId: branches[0].id,
        topics: [],
      });
      await assert.rejects(() => crt.practiceSession(peer, practice.id));
      await assert.rejects(() => crt.practiceImage(peer, practice.id, imageId));
    },
  );
  await t.test(
    "feature revocation is enforced against a stale identity and migrations rerun with PDF data",
    async () => {
      await crt.assign(admin, {
        organizationId: org.id,
        branchId: branches[0].id,
        topics: [{ topicId: topic.id, versionId: topic.versionId! }],
      });
      await scoped(connection.db, { platform: true }, (tx) =>
        tx.insert(s.accessPolicies).values({
          organizationId: org.id,
          scope: "organization",
          targetKey: "organization",
          policy: {
            features: [],
            courseIds: null,
            practiceModuleIds: null,
            toolkitTrackIds: null,
          },
        }),
      );
      await assert.rejects(() => crt.studentList(student));
      await assert.rejects(() => crt.pdf(student, topic.id));
      await migrateDatabase(connection.db);
      const [upload] = await service.scope(admin, (tx) =>
        tx.select().from(s.lessonUploads).where(eq(s.lessonUploads.id, pdfId)),
      );
      assert.equal(upload.status, "ready");
    },
  );
  await connection.close();
});
