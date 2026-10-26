import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import { lessonInput } from "./lesson-input.js";
import type { LessonStorage } from "./lesson-storage.js";
import * as s from "./schema.js";

// Real HTTP/auth/RLS with isolated PostgreSQL; storage never leaves this test process.
test("rich lessons, assignments, MCQ grading and private assets", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "lesson-tests-only-secret-at-least-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const objects = new Map<string, { size: number; contentType: string }>();
  const staged = new Map<string, { size: number; contentType: string }>();
  let enabled = true;
  const storage: LessonStorage = {
    configured: () => enabled,
    async upload(key, contentType, size) {
      staged.set(key, { size, contentType });
      return `https://private.test/put/${key}`;
    },
    async head(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Not uploaded");
      return value;
    },
    async finalize(from, to) {
      objects.set(to, { ...objects.get(from)! });
      objects.delete(from);
    },
    async download(key, name, attachment) {
      return `https://private.test/get/${key}?attachment=${attachment}&filename=${encodeURIComponent(name)}`;
    },
  };
  const service = new SlateService(
    connection.db,
    auth,
    config,
    true,
    storage,
  );
  const orgs = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "Lesson College" }, { name: "Other College" }])
      .returning(),
  );
  async function person(
    name: string,
    role: "student" | "platform_admin" | "organization_viewer",
    orgId: string | null,
  ) {
    const password = "Lessons-test-password-only!";
    const identity = await auth.api.createUser({
      body: {
        name,
        email: `${name}@lessons.invalid`,
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
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    const login = await auth.api.signInEmail({
      body: { email: identity.user.email, password },
      asResponse: true,
    });
    assert.equal(login.status, 200);
    return {
      ...member,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  const admin = await person("lesson-admin", "platform_admin", null);
  const student = await person("lesson-student", "student", orgs[0].id);
  const classmate = await person("lesson-classmate", "student", orgs[0].id);
  const outsider = await person("lesson-outsider", "student", orgs[1].id);
  const viewer = await person(
    "lesson-viewer",
    "organization_viewer",
    orgs[0].id,
  );
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(
    path: string,
    cookie = admin.cookie,
    method = "GET",
    body?: unknown,
  ) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: {
        Origin: config.origins[0],
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  const [course] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.courses)
      .values({
        title: "Rich content",
        description: "Learning by reading, watching and applying",
        track: "general",
      })
      .returning(),
  );
  const coursePath = `platform/courses/${course.id}`;
  const legacy = {
    id: randomUUID(),
    title: "Legacy lesson",
    body: "<plain content>\nsecond line",
  };
  const article = {
    id: randomUUID(),
    title: "Article",
    body: "# Introduction\n\n- One\n- Two\n\n**Important**",
    kind: "text",
    format: "markdown",
  };
  const assignment = {
    id: randomUUID(),
    title: "Project",
    body: "## Build a project",
    kind: "assignment",
    format: "markdown",
    assignment: { acceptText: true, acceptLink: true, acceptFiles: true },
  };
  const textOnly = {
    id: randomUUID(),
    title: "Explain",
    body: "Explain the concept",
    kind: "assignment",
    assignment: { acceptText: true, acceptLink: false, acceptFiles: false },
  };
  const quiz = {
    id: randomUUID(),
    title: "Knowledge check",
    body: "Choose the best answer.",
    kind: "quiz",
    quiz: {
      passingScore: 100,
      questions: [
        {
          id: "one",
          prompt: "Two plus two?",
          options: ["3", "4", "5"],
          correctOption: 1,
          explanation: "Two pairs make four.",
        },
        {
          id: "two",
          prompt: "Which is a loop?",
          options: ["if", "for"],
          correctOption: 1,
          explanation: "A for loop repeats.",
        },
      ],
    },
  };
  const lessonPath = (lessonId: string) =>
    `student/courses/${course.id}/lessons/${lessonId}`;
  let versionId = "";
  let uploadId = "";
  let videoLesson: any;
  try {
    await t.test(
      "publish validates rich lesson kinds and question structure",
      async () => {
        for (const invalid of [
          {
            ...assignment,
            assignment: {
              acceptText: false,
              acceptLink: false,
              acceptFiles: false,
            },
          },
          {
            ...quiz,
            quiz: {
              ...quiz.quiz,
              questions: [{ ...quiz.quiz.questions[0], correctOption: 5 }],
            },
          },
          {
            ...quiz,
            quiz: {
              ...quiz.quiz,
              questions: [quiz.quiz.questions[0], quiz.quiz.questions[0]],
            },
          },
          {
            id: randomUUID(),
            title: "Bad video",
            body: "",
            kind: "video",
            video: { url: "javascript:alert(1)" },
          },
          { id: randomUUID(), title: "Empty", body: "", kind: "text" },
        ])
          assert.equal(
            (
              await request(`${coursePath}/publish`, admin.cookie, "POST", {
                title: course.title,
                description: course.description,
                lessons: [invalid],
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request(`${coursePath}/publish`, student.cookie, "POST", {
              title: course.title,
              description: course.description,
              lessons: [legacy],
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(`${coursePath}/publish`, admin.cookie, "POST", {
              title: course.title,
              description: course.description,
              lessons: [
                {
                  title: "Pending",
                  body: "",
                  kind: "video",
                  video: { uploadId: randomUUID() },
                },
              ],
            })
          ).status,
          400,
        );
        const cleaned = lessonInput.parse({
          ...article,
          assignment: {
            acceptText: true,
            acceptLink: false,
            acceptFiles: false,
          },
          video: { url: "https://example.test/movie.mp4" },
        });
        assert.equal(cleaned.video, undefined);
        assert.equal(cleaned.assignment, undefined);
      },
    );
    await t.test(
      "video upload validates role, MIME, extension and size and fails clearly when storage is absent",
      async () => {
        const input = {
          purpose: "video",
          fileName: "lesson.mp4",
          contentType: "video/mp4",
          size: 1234,
        };
        assert.equal(
          (await request("lesson-uploads", student.cookie, "POST", input))
            .status,
          403,
        );
        for (const value of [
          { ...input, size: 251 * 1024 * 1024 },
          { ...input, fileName: "lesson.html" },
          { ...input, contentType: "text/html" },
          { ...input, fileName: "../../secret.mp4" },
        ])
          assert.equal(
            (await request("lesson-uploads", admin.cookie, "POST", value))
              .status,
            400,
          );
        enabled = false;
        const unavailable = await request(
          "lesson-uploads",
          admin.cookie,
          "POST",
          input,
        );
        assert.equal(unavailable.status, 503);
        assert.match(unavailable.body.message, /storage/i);
        enabled = true;
        const created = await request(
          "lesson-uploads",
          admin.cookie,
          "POST",
          input,
        );
        assert.equal(created.status, 201);
        uploadId = created.body.upload.id;
        assert.equal(
          (
            await request(
              `lesson-uploads/${uploadId}/complete`,
              admin.cookie,
              "POST",
            )
          ).status,
          400,
        );
        const key = [...staged.keys()].at(-1)!;
        objects.set(key, { size: 1235, contentType: "video/mp4" });
        assert.equal(
          (
            await request(
              `lesson-uploads/${uploadId}/complete`,
              admin.cookie,
              "POST",
            )
          ).status,
          400,
        );
        objects.set(key, staged.get(key)!);
        assert.equal(
          (
            await request(
              `lesson-uploads/${uploadId}/complete`,
              admin.cookie,
              "POST",
            )
          ).status,
          201,
        );
        const immutable = (await request(`lesson-uploads/${uploadId}/download`))
          .body.url;
        assert.match(immutable, /lesson-assets/);
        assert.match(immutable, /attachment=false/);
        objects.set(key, { size: 999, contentType: "video/mp4" });
        assert.equal(
          (await request(`lesson-uploads/${uploadId}/download`)).body.url,
          immutable,
          "replaying a PUT cannot replace the immutable published object",
        );
        assert.equal(
          (await request(`lesson-uploads/${uploadId}/download`, student.cookie))
            .status,
          404,
        );
      },
    );
    await t.test(
      "legacy and Markdown lessons retain structure; student course response never reveals MCQ keys",
      async () => {
        videoLesson = {
          id: randomUUID(),
          title: "Watch",
          body: "Video description",
          kind: "video",
          video: { uploadId },
        };
        const published = await request(
          `${coursePath}/publish`,
          admin.cookie,
          "POST",
          {
            title: course.title,
            description: course.description,
            lessons: [legacy, article, assignment, textOnly, quiz, videoLesson],
          },
        );
        assert.equal(published.status, 201);
        versionId = published.body.id;
        for (const person of [student, classmate])
          assert.equal(
            (
              await request("platform/assignments", admin.cookie, "POST", {
                memberId: person.id,
                courseId: course.id,
              })
            ).status,
            201,
          );
        const detail = await request(
          `student/courses/${course.id}`,
          student.cookie,
        );
        assert.equal(detail.status, 200);
        assert.deepEqual(detail.body.lessons[0], legacy);
        assert.deepEqual(detail.body.lessons[1], article);
        const text = JSON.stringify(detail.body);
        assert.equal(text.includes("correctOption"), false);
        assert.equal(text.includes("Two pairs make four"), false);
        assert.equal(
          (await request(coursePath)).body.lessons.find(
            (l: any) => l.kind === "quiz",
          ).quiz.questions[0].correctOption,
          1,
        );
        assert.equal(
          (await request(`${lessonPath(videoLesson.id)}/video`, student.cookie))
            .status,
          200,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(videoLesson.id)}/video`,
              outsider.cookie,
            )
          ).status,
          403,
        );
        assert.equal(
          (await request(`${lessonPath(videoLesson.id)}/video`, viewer.cookie))
            .status,
          403,
        );
      },
    );
    await t.test(
      "assignment/quiz generic completion cannot bypass submitting; legacy completion still works",
      async () => {
        for (const item of [assignment, quiz])
          assert.equal(
            (
              await request(
                `${lessonPath(item.id)}/complete`,
                student.cookie,
                "POST",
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              `${lessonPath(legacy.id)}/complete`,
              student.cookie,
              "POST",
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
            )
          ).body,
          null,
        );
      },
    );
    await t.test(
      "assignment submission validates methods, URLs, version and access, then records completion",
      async () => {
        for (const body of [
          {},
          { answer: " " },
          { url: "http://example.test/project" },
          { url: "https://username:secret@example.test" },
          { answers: { one: 1 } },
        ])
          assert.equal(
            (
              await request(
                `${lessonPath(assignment.id)}/submission`,
                student.cookie,
                "POST",
                body,
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              `${lessonPath(textOnly.id)}/submission`,
              student.cookie,
              "POST",
              { url: "https://example.test/project" },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              outsider.cookie,
              "POST",
              { answer: "Wrong access" },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
              "POST",
              { versionId: randomUUID(), answer: "Stale" },
            )
          ).status,
          409,
        );
        const saved = await request(
          `${lessonPath(assignment.id)}/submission`,
          student.cookie,
          "POST",
          {
            versionId,
            answer: "My explanation",
            url: "https://example.test/project",
          },
        );
        assert.equal(saved.status, 201);
        assert.equal(saved.body.answer, "My explanation");
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
            )
          ).body.id,
          saved.body.id,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              classmate.cookie,
            )
          ).body,
          null,
        );
        assert.equal(
          (
            await request(`student/courses/${course.id}`, student.cookie)
          ).body.completedLessonIds.includes(assignment.id),
          true,
        );
        const updated = await request(
          `${lessonPath(assignment.id)}/submission`,
          student.cookie,
          "POST",
          { answer: "Revised explanation" },
        );
        assert.equal(updated.body.id, saved.body.id);
        assert.equal(updated.body.answer, "Revised explanation");
      },
    );
    await t.test(
      "MCQ grades on server, reveals results only after submitting, and requires passing for completion",
      async () => {
        for (const answers of [
          { one: 1 },
          { one: 1, two: 4 },
          { one: 1, two: 1, extra: 1 },
        ])
          assert.equal(
            (
              await request(
                `${lessonPath(quiz.id)}/submission`,
                student.cookie,
                "POST",
                { answers },
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              `${lessonPath(quiz.id)}/submission`,
              student.cookie,
              "POST",
              { answers: { one: 1, two: 1 }, score: 100 },
            )
          ).status,
          400,
        );
        const failed = await request(
          `${lessonPath(quiz.id)}/submission`,
          student.cookie,
          "POST",
          { answers: { one: 0, two: 1 } },
        );
        assert.equal(failed.status, 201);
        assert.equal(failed.body.score, 50);
        assert.equal(failed.body.passed, false);
        assert.equal(failed.body.quizResults[0].correctOption, 1);
        assert.equal(
          (
            await request(`student/courses/${course.id}`, student.cookie)
          ).body.completedLessonIds.includes(quiz.id),
          false,
        );
        const passed = await request(
          `${lessonPath(quiz.id)}/submission`,
          student.cookie,
          "POST",
          { answers: { one: 1, two: 1 } },
        );
        assert.equal(passed.body.id, failed.body.id);
        assert.equal(passed.body.passed, true);
        assert.equal(passed.body.score, 100);
        const retake = await request(
          `${lessonPath(quiz.id)}/submission`,
          student.cookie,
          "POST",
          { answers: { one: 0, two: 0 } },
        );
        assert.equal(retake.body.passed, false);
        assert.equal(retake.body.id, passed.body.id);
        assert.equal(
          (
            await request(`student/courses/${course.id}`, student.cookie)
          ).body.completedLessonIds.includes(quiz.id),
          true,
        );
        assert.equal(
          JSON.stringify(
            (await request(`student/courses/${course.id}`, student.cookie))
              .body,
          ).includes("correctOption"),
          false,
        );
      },
    );
    await t.test(
      "assignment uploads enforce owner, lesson, version, ready-state and attachment constraints",
      async () => {
        const upload = {
          purpose: "assignment",
          fileName: "project.pdf",
          contentType: "application/pdf",
          size: 400,
          courseId: course.id,
          lessonId: assignment.id,
        };
        for (const body of [
          { ...upload, size: 11 * 1024 * 1024 },
          { ...upload, contentType: "text/html" },
          { ...upload, lessonId: textOnly.id },
        ])
          assert.ok(
            [400, 403].includes(
              (await request("lesson-uploads", student.cookie, "POST", body))
                .status,
            ),
          );
        assert.equal(
          (await request("lesson-uploads", outsider.cookie, "POST", upload))
            .status,
          403,
        );
        const created = await request(
          "lesson-uploads",
          student.cookie,
          "POST",
          upload,
        );
        assert.equal(created.status, 201);
        const id = created.body.upload.id;
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
              "POST",
              { uploadIds: [id] },
            )
          ).status,
          400,
        );
        const key = [...staged.keys()].at(-1)!;
        objects.set(key, staged.get(key)!);
        assert.equal(
          (
            await request(
              `lesson-uploads/${id}/complete`,
              classmate.cookie,
              "POST",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `lesson-uploads/${id}/complete`,
              student.cookie,
              "POST",
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              classmate.cookie,
              "POST",
              { uploadIds: [id] },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
              "POST",
              { uploadIds: [id, id] },
            )
          ).status,
          400,
        );
        const saved = await request(
          `${lessonPath(assignment.id)}/submission`,
          student.cookie,
          "POST",
          { uploadIds: [id] },
        );
        assert.equal(saved.status, 201);
        assert.equal(saved.body.files[0].id, id);
        assert.match(
          (await request(`lesson-uploads/${id}/download`, student.cookie)).body
            .url,
          /attachment=true/,
        );
        assert.equal(
          (await request(`lesson-uploads/${id}/download`, classmate.cookie))
            .status,
          404,
        );
        assert.equal(
          (await request(`lesson-uploads/${id}/download`, outsider.cookie))
            .status,
          404,
        );
        assert.equal(
          (await request(`lesson-uploads/${id}/download`, viewer.cookie))
            .status,
          403,
        );
        assert.equal(
          (await request(`lesson-uploads/${id}/download`)).status,
          200,
        );
        const leaked = await scoped(
          connection.db,
          { authId: classmate.authUserId, organizationId: orgs[0].id },
          (tx) => tx.select().from(s.lessonUploads),
        );
        assert.deepEqual(
          leaked,
          [],
          "RLS hides classmate files and video storage metadata",
        );
        const submissions = await scoped(
          connection.db,
          { authId: classmate.authUserId, organizationId: orgs[0].id },
          (tx) => tx.select().from(s.lessonSubmissions),
        );
        assert.deepEqual(
          submissions,
          [],
          "RLS hides other students' answers within the same organization",
        );
      },
    );
    await t.test(
      "admin reviews student submissions; publication preserves pinned content, submissions and completion",
      async () => {
        const before = (await request(`${coursePath}/submissions`)).body;
        assert.equal(before.length, 2);
        assert.equal(before[0].studentName, "lesson-student");
        assert.equal(before[0].versionNumber, 1);
        assert.ok(before.every((row: any) => row.lessonTitle));
        const quizReview = before.find((row: any) => row.kind === "quiz");
        assert.equal(
          quizReview.quizQuestions[0].prompt,
          quiz.quiz.questions[0].prompt,
        );
        assert.equal(quizReview.quizQuestions[0].correctOption, undefined);
        for (const cookie of [student.cookie, viewer.cookie])
          assert.equal(
            (await request(`${coursePath}/submissions`, cookie)).status,
            403,
          );
        const nextQuiz = {
          ...quiz,
          quiz: {
            ...quiz.quiz,
            questions: quiz.quiz.questions.map((q) => ({
              ...q,
              correctOption: 0,
            })),
          },
        };
        const newVersion = await request(
          `${coursePath}/publish`,
          admin.cookie,
          "POST",
          {
            title: "New content",
            description: course.description,
            lessons: [legacy, nextQuiz],
          },
        );
        assert.equal(newVersion.status, 201);
        assert.notEqual(newVersion.body.id, versionId);
        const pinned = await request(
          `student/courses/${course.id}`,
          student.cookie,
        );
        assert.equal(pinned.body.versionId, versionId);
        assert.equal(
          (
            await request(
              `${lessonPath(quiz.id)}/submission`,
              student.cookie,
              "POST",
              { answers: { one: 1, two: 1 } },
            )
          ).body.passed,
          true,
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              student.cookie,
            )
          ).body.files.length,
          1,
        );
        await migrateDatabase(connection.db);
        assert.equal(
          (await request(`${coursePath}/submissions`)).body.length,
          2,
        );
        assert.ok(
          (
            await connection.db.execute(
              sql`select id from migrations where id='006-rich-lessons'`,
            )
          ).rows.length,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.grants)
            .set({ versionId: newVersion.body.id })
            .where(eq(s.grants.memberId, classmate.id)),
        );
        assert.equal(
          (
            await request(
              `${lessonPath(assignment.id)}/submission`,
              classmate.cookie,
            )
          ).status,
          404,
        );
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
