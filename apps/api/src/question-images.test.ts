import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { ExamDraft } from "@slate/contracts";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { createAuth } from "./auth.js";
import { createApplication } from "./app.js";
import { SlateService, type Actor } from "./service.js";
import { ExamService } from "./exams.js";
import { LessonService } from "./lessons.js";
import { lessonInput } from "./lesson-input.js";
import type { LessonStorage } from "./lesson-storage.js";
import { matchesQuestionImageType } from "./question-images.js";
import * as s from "./schema.js";

test("MCQ images stay private, validated and bound to assigned versions and attempts", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "question-images-only-test-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  type ObjectValue = { size: number; contentType: string; bytes: Uint8Array };
  const objects = new Map<string, ObjectValue>();
  let uploadBytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  let tamperCopy = false;
  let downloads = 0;
  const storage: LessonStorage = {
    configured: () => true,
    async upload(key, contentType, size) {
      objects.set(key, { size, contentType, bytes: uploadBytes });
      return `https://private.invalid/put/${key}`;
    },
    async head(key) {
      const object = objects.get(key);
      if (!object) throw new Error("missing");
      return object;
    },
    async readPrefix(key, length) {
      return objects.get(key)!.bytes.slice(0, length);
    },
    async finalize(from, to) {
      objects.set(to, {
        ...objects.get(from)!,
        ...(tamperCopy
          ? { bytes: new TextEncoder().encode("<svg>unsafe</svg>") }
          : {}),
      });
      objects.delete(from);
    },
    async download(key, name, attachment) {
      downloads++;
      return `https://private.invalid/get/${key}?attachment=${attachment}`;
    },
  };
  const service = new SlateService(
    connection.db,
    auth,
    config,
    true,
    storage,
  );
  const lessons = new LessonService(service, storage),
    exams = new ExamService(service);
  const [org, other] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "Image College" }, { name: "Other College" }])
      .returning(),
  );
  await scoped(connection.db, { platform: true }, (tx) =>
    tx.insert(s.organizationBranches).values({
      organizationId: org.id,
      code: "CSE",
      name: "Computer Science",
    }),
  );
  async function person(
    name: string,
    role: Actor["role"],
    orgId: string | null,
  ) {
    const password = "Images-tests-only-password!";
    const identity = await auth.api.createUser({
      body: {
        name,
        email: `${name}@images.invalid`,
        password,
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: identity.user.id,
          organizationId: orgId,
          role,
          branchCode: orgId ? "CSE" : null,
          branchName: orgId ? "Computer Science" : null,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    const login = await auth.api.signInEmail({
      body: { email: identity.user.email, password },
      asResponse: true,
    });
    const actor: Actor = {
      id: member.id,
      authId: identity.user.id,
      sessionId: "test",
      name,
      email: identity.user.email,
      role,
      organizationId: orgId,
      organizationName: orgId ? "Image College" : null,
      onboardingStep: null,
      features: ["courses", "live-exams"],
    };
    return {
      actor,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  const admin = await person("admin", "platform_admin", null),
    student = await person("student", "student", org.id),
    peer = await person("peer", "student", org.id),
    outsider = await person("outside", "student", other.id),
    viewer = await person("viewer", "organization_viewer", org.id);
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(
    path: string,
    who = student,
    method = "GET",
    body?: unknown,
  ) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: {
        Origin: config.origins[0],
        Cookie: who.cookie,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  const uploadInput = {
    purpose: "question_image" as const,
    fileName: "diagram.png",
    contentType: "image/png",
    size: 16,
  };
  async function upload() {
    const started = await lessons.createUpload(admin.actor, uploadInput);
    return (await lessons.completeUpload(admin.actor, started.upload.id)).id;
  }
  let imageId = "",
    newerImage = "";
  const lessonId = randomUUID();
  const lesson = (id: string) =>
    lessonInput.parse({
      id: lessonId,
      title: "Visual question",
      body: "Read the diagram.",
      kind: "quiz",
      quiz: {
        passingScore: 100,
        questions: [
          {
            id: "diagram",
            prompt: "Which path is shortest?",
            image: { uploadId: id, alt: "A graph with paths A and B" },
            options: ["A", "B"],
            correctOption: 0,
            explanation: "A has fewer edges.",
          },
        ],
      },
    });
  const [course] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.courses)
      .values({
        title: "Graphs",
        description: "Visual graphs",
        track: "general",
      })
      .returning(),
  );
  let versionId = "";
  const imagePath = (id: string) =>
    `student/courses/${course.id}/lessons/${lessonId}/images/${id}`;
  try {
    await t.test(
      "only platform admins upload bounded raster images with an accessible description",
      async () => {
        for (const who of [student, peer, outsider, viewer])
          assert.equal(
            (await request("lesson-uploads", who, "POST", uploadInput)).status,
            403,
          );
        for (const changes of [
          { contentType: "image/svg+xml", fileName: "x.svg" },
          { contentType: "text/html", fileName: "x.html" },
          { size: 5 * 1024 * 1024 + 1 },
          { fileName: "x.svg" },
          { courseId: course.id },
        ])
          assert.equal(
            (
              await request("lesson-uploads", admin, "POST", {
                ...uploadInput,
                ...changes,
              })
            ).status,
            400,
          );
        const baseLesson = lesson(randomUUID());
        assert.equal(
          lessonInput.safeParse({
            ...baseLesson,
            quiz: {
              ...baseLesson.quiz,
              questions: [
                {
                  ...baseLesson.quiz!.questions[0],
                  image: { uploadId: randomUUID(), alt: " " },
                },
              ],
            },
          }).success,
          false,
        );
        assert.ok(
          matchesQuestionImageType(
            Uint8Array.from([255, 216, 255]),
            "image/jpeg",
          ),
        );
        assert.ok(
          matchesQuestionImageType(
            new TextEncoder().encode("RIFF0000WEBP"),
            "image/webp",
          ),
        );
        assert.equal(
          matchesQuestionImageType(
            new TextEncoder().encode("<svg>"),
            "image/png",
          ),
          false,
        );
        assert.equal(
          matchesQuestionImageType(
            new TextEncoder().encode("RIFF0000WAVE"),
            "image/webp",
          ),
          false,
        );
      },
    );
    await t.test(
      "finalization rejects disguised images and verifies the final immutable copy",
      async () => {
        const validBytes = uploadBytes;
        uploadBytes = new TextEncoder().encode("<svg>unsafe</svg>");
        const bad = await lessons.createUpload(admin.actor, uploadInput);
        await assert.rejects(
          lessons.completeUpload(admin.actor, bad.upload.id),
          /not a valid PNG/,
        );
        uploadBytes = validBytes;
        tamperCopy = true;
        const changed = await lessons.createUpload(admin.actor, uploadInput);
        await assert.rejects(
          lessons.completeUpload(admin.actor, changed.upload.id),
          /not a valid PNG/,
        );
        tamperCopy = false;
        imageId = await upload();
        newerImage = await upload();
        assert.equal(
          (await request(`lesson-uploads/${imageId}/download`, admin)).status,
          200,
        );
        assert.match(
          (await request(`lesson-uploads/${imageId}/download`, admin)).body.url,
          /attachment=false/,
        );
      },
    );
    await t.test(
      "course publishing rejects pending, missing and wrong-purpose image references",
      async () => {
        const pending = await lessons.createUpload(admin.actor, uploadInput);
        const video = await lessons.createUpload(admin.actor, {
          purpose: "video",
          fileName: "video.mp4",
          contentType: "video/mp4",
          size: 16,
        });
        await lessons.completeUpload(admin.actor, video.upload.id);
        for (const id of [pending.upload.id, randomUUID(), video.upload.id])
          await assert.rejects(
            service.publishCourse(admin.actor, course.id, {
              title: course.title,
              description: course.description,
              lessons: [lesson(id)],
            }),
            /Finish uploading each question image/,
          );
        const v = await service.publishCourse(admin.actor, course.id, {
          title: course.title,
          description: course.description,
          lessons: [lesson(imageId)],
        });
        versionId = v.id;
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .insert(s.grants)
            .values({
              organizationId: org.id,
              memberId: student.actor.id,
              courseId: course.id,
              versionId,
            }),
        );
      },
    );
    await t.test(
      "students only get assigned lesson images; generic IDs and other tenants cannot fetch them",
      async () => {
        const before = downloads;
        for (const who of [student, peer, outsider, viewer])
          assert.notEqual(
            (await request(`lesson-uploads/${imageId}/download`, who)).status,
            200,
          );
        for (const who of [peer, outsider, viewer])
          assert.notEqual((await request(imagePath(imageId), who)).status, 200);
        assert.equal((await request(imagePath(newerImage))).status, 404);
        assert.equal(downloads, before);
        assert.equal((await request(imagePath(imageId))).status, 200);
        const visible = await service.course(student.actor, course.id);
        assert.deepEqual(visible.lessons[0].quiz!.questions[0].image, {
          uploadId: imageId,
          alt: "A graph with paths A and B",
        });
        assert.equal(
          "correctOption" in visible.lessons[0].quiz!.questions[0],
          false,
        );
        assert.equal(
          "explanation" in visible.lessons[0].quiz!.questions[0],
          false,
        );
        const raw = await service.scope(student.actor, (tx) =>
          tx.select().from(s.lessonUploads),
        );
        assert.equal(raw.length, 0);
      },
    );
    await t.test(
      "republishing preserves pinned imagery and admin reviews use the submitted course version",
      async () => {
        await lessons.submit(student.actor, course.id, lessonId, {
          versionId,
          answers: { diagram: 0 },
        });
        await service.publishCourse(admin.actor, course.id, {
          title: course.title,
          description: course.description,
          lessons: [lesson(newerImage)],
        });
        assert.equal((await request(imagePath(imageId))).status, 200);
        assert.equal((await request(imagePath(newerImage))).status, 404);
        const review = await lessons.review(admin.actor, course.id);
        assert.equal(review[0].quizQuestions![0].image!.uploadId, imageId);
        assert.equal(review[0].versionId, versionId);
      },
    );
    await t.test(
      "course image access stops immediately when the assigned course is removed",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx.delete(s.grants).where(eq(s.grants.memberId, student.actor.id)),
        );
        assert.equal((await request(imagePath(imageId))).status, 403);
      },
    );
    await t.test(
      "exam drafts validate assets and started attempts retain images without leaking answer keys",
      async () => {
        const draft: ExamDraft = {
          codingGrading: "manual",
          organizationId: org.id,
          title: "Image exam",
          description: "Graphs",
          instructions: "Choose one answer",
          audience: {
            mode: "students",
            studentIds: [student.actor.id],
            branchCodes: ["CSE"],
          },
          startsAt: new Date(Date.now() + 60000).toISOString(),
          endsAt: new Date(Date.now() + 3600000).toISOString(),
          durationMinutes: 15,
          passingPercentage: 50,
          monitoring: {
            enabled: false,
            requireFullscreen: false,
            recordClipboard: false,
          },
          questions: [
            {
              id: "diagram",
              kind: "mcq",
              title: "Shortest path",
              prompt: "Which path is shortest?",
              image: { uploadId: imageId, alt: "A graph with paths A and B" },
              points: 10,
              options: ["A", "B"],
              correctOption: 0,
              explanation: "A is shortest.",
            },
          ],
        };
        const missing = {
          ...draft,
          questions: draft.questions.map((q) => ({
            ...q,
            image: { uploadId: randomUUID(), alt: "Missing" },
          })),
        };
        await assert.rejects(
          exams.create(admin.actor, { ...missing, clientId: randomUUID() }),
          /Finish uploading/,
        );
        let exam = await exams.create(admin.actor, {
          ...draft,
          clientId: randomUUID(),
        });
        await assert.rejects(
          exams.update(admin.actor, exam.id, {
            ...missing,
            revision: exam.revision,
          }),
          /Finish uploading/,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.lessonUploads)
            .set({ status: "pending" })
            .where(eq(s.lessonUploads.id, imageId)),
        );
        await assert.rejects(
          exams.publish(admin.actor, exam.id, exam.revision),
          /Finish uploading/,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.lessonUploads)
            .set({ status: "ready" })
            .where(eq(s.lessonUploads.id, imageId)),
        );
        exam = await exams.publish(admin.actor, exam.id, exam.revision);
        assert.equal(
          (
            await request(
              `student/exam-attempts/${randomUUID()}/images/${imageId}`,
            )
          ).status,
          404,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.liveExams)
            .set({ startsAt: new Date(Date.now() - 1000) })
            .where(eq(s.liveExams.id, exam.id)),
        );
        const attempt = await exams.start(student.actor, exam.id);
        assert.equal(
          attempt.questions[0].kind === "mcq" &&
            attempt.questions[0].image?.uploadId,
          imageId,
        );
        assert.equal("correctOption" in attempt.questions[0], false);
        assert.equal("explanation" in attempt.questions[0], false);
        const endpoint = `student/exam-attempts/${attempt.id}/images/${imageId}`;
        assert.equal((await request(endpoint)).status, 200);
        for (const who of [peer, outsider, viewer])
          assert.notEqual((await request(endpoint, who)).status, 200);
        assert.equal(
          (
            await request(
              `student/exam-attempts/${attempt.id}/images/${newerImage}`,
            )
          ).status,
          404,
        );
        await exams.save(
          student.actor,
          attempt.id,
          {
            revision: 0,
            answers: [{ questionId: "diagram", selectedOption: 0 }],
          },
          true,
        );
        assert.equal((await request(endpoint)).status, 200);
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ status: "suspended" })
            .where(eq(s.members.id, student.actor.id)),
        );
        assert.notEqual((await request(endpoint)).status, 200);
      },
    );
    await t.test(
      "image migration is repeatable with existing assets and keeps readers isolated",
      async () => {
        await migrateDatabase(connection.db);
        const assets = await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .select()
            .from(s.lessonUploads)
            .where(eq(s.lessonUploads.id, imageId)),
        );
        assert.equal(assets[0].status, "ready");
        await assert.rejects(
          scoped(
            connection.db,
            {
              authId: viewer.actor.authId,
              organizationId: org.id,
              readonly: true,
            },
            (tx) => tx.execute(sql`select * from lesson_uploads`),
          ),
        );
        assert.equal(
          (
            await connection.db.execute(
              sql`select count(*)::integer as count from migrations where id='011-mcq-images'`,
            )
          ).rows[0].count,
          1,
        );
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
