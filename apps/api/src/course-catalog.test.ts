import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { inheritPolicy } from "./access.js";
import { SlateService } from "./service.js";
import { decryptPayload, formatEnrollmentMail } from "./providers.js";
import { deliverOne } from "./mail-worker.js";
import type { LessonStorage } from "./lesson-storage.js";
import * as s from "./schema.js";

test("course discovery, recent learning, covers and enrollment requests preserve access boundaries", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "course-catalog-test-only-secret-with-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const objects = new Map<string, { size: number; contentType: string }>();
  let validImage = true;
  const storage: LessonStorage = {
    configured: () => true,
    async upload(key, contentType, size) {
      objects.set(key, { contentType, size });
      return `https://storage.example.test/${key}`;
    },
    async head(key) {
      return objects.get(key)!;
    },
    async finalize(source, target) {
      objects.set(target, objects.get(source)!);
    },
    async readPrefix() {
      return new Uint8Array(
        validImage ? [137, 80, 78, 71, 13, 10, 26, 10] : [0, 0, 0, 0],
      );
    },
    async download(key) {
      return `https://storage.example.test/${key}?signed=1`;
    },
  };
  const service = new SlateService(
    connection.db,
    auth,
    config,
    {
      configured: false,
      async send() {
        assert.fail("No external messaging during tests");
      },
    },
    true,
    storage,
  );
  const [org, other] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "Discovery College" }, { name: "Other College" }])
      .returning(),
  );
  async function person(
    name: string,
    role: "platform_admin" | "student" | "organization_viewer",
    organizationId: string | null,
    branchCode: string | null = null,
  ) {
    const password = "Course-catalog-isolated-test!2026";
    const created = await auth.api.createUser({
      body: {
        name,
        email: `${name}@example.test`,
        password,
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: created.user.id,
          organizationId,
          role,
          branchCode,
          branchName: branchCode ? "Computer Science" : null,
          studentId: role === "student" ? name : null,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    const login = await auth.api.signInEmail({
      body: { email: created.user.email, password },
      asResponse: true,
    });
    return {
      ...member,
      cookie: login.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; "),
    };
  }
  const admin = await person("catalog-admin", "platform_admin", null),
    student = await person("catalog-student", "student", org.id, "CSE"),
    peer = await person("catalog-peer", "student", org.id, "CSE"),
    outsider = await person("catalog-outside", "student", other.id, "CSE"),
    viewer = await person("catalog-viewer", "organization_viewer", org.id);
  const courses = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      const rows = await tx
        .insert(s.courses)
        .values(
          [
            "A Enrolled",
            "B Available",
            "C Other branch",
            "D Outside ceiling",
            "E Enrolled",
          ].map((title) => ({
            title,
            description: `About ${title}`,
            track: "general",
            status: "published",
          })),
        )
        .returning();
      const versions = await tx
        .insert(s.versions)
        .values(
          rows.map((course) => ({
            courseId: course.id,
            number: 1,
            title: course.title,
            description: course.description,
            lessons: [
              {
                id: randomUUID(),
                title: "Private lesson",
                body: "PRIVATE lesson content",
                kind: "quiz" as const,
                quiz: {
                  passingScore: 100,
                  questions: [
                    {
                      id: "secret",
                      prompt: "Question",
                      options: ["a", "b"],
                      correctOption: 0,
                      explanation: "SECRET KEY",
                    },
                  ],
                },
              },
            ],
          })),
        )
        .returning();
      await tx.insert(s.organizationBranches).values([
        { organizationId: org.id, code: "CSE", name: "Computer Science" },
        {
          organizationId: other.id,
          code: "CSE",
          name: "Other Computer Science",
        },
      ]);
      const ids = rows.map((c) => c.id),
        pins = Object.fromEntries(versions.map((v) => [v.courseId, v.id]));
      await tx.insert(s.accessPolicies).values([
        {
          organizationId: org.id,
          scope: "organization",
          targetKey: "organization",
          policy: {
            ...inheritPolicy(),
            courseIds: [ids[0], ids[1], ids[2], ids[4]],
          },
          courseVersions: pins,
        },
        {
          organizationId: org.id,
          scope: "branch",
          targetKey: "CSE",
          policy: { ...inheritPolicy(), courseIds: [ids[0], ids[1], ids[4]] },
          courseVersions: pins,
        },
        {
          organizationId: org.id,
          scope: "student",
          targetKey: student.id,
          policy: { ...inheritPolicy(), courseIds: [ids[0], ids[4]] },
          courseVersions: pins,
        },
        {
          organizationId: org.id,
          scope: "student",
          targetKey: peer.id,
          policy: { ...inheritPolicy(), courseIds: [] },
          courseVersions: {},
        },
        {
          organizationId: other.id,
          scope: "organization",
          targetKey: "organization",
          policy: { ...inheritPolicy(), courseIds: [ids[3]] },
          courseVersions: pins,
        },
        {
          organizationId: other.id,
          scope: "student",
          targetKey: outsider.id,
          policy: { ...inheritPolicy(), courseIds: [] },
          courseVersions: {},
        },
      ]);
      // A historical grant is insufficient when effective student access explicitly excludes it.
      await tx.insert(s.grants).values({
        organizationId: org.id,
        memberId: student.id,
        courseId: ids[1],
        versionId: versions[1].id,
      });
      await tx.insert(s.progress).values({
        organizationId: org.id,
        memberId: student.id,
        versionId: versions[0].id,
        lessonId: versions[0].lessons[0].id,
      });
      return rows;
    },
  );
  const [a, b, c, d, e] = courses;
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
  const enrollPath = `student/courses/${b.id}/enrollment-requests`;
  let requestId = "",
    coverUploadId = "";
  const before = await scoped(
    connection.db,
    { platform: true },
    async (tx) => ({
      grants: await tx.select().from(s.grants),
      progress: await tx.select().from(s.progress),
    }),
  );
  try {
    await t.test(
      "discovery exposes only published metadata inside organization and branch ceiling, using effective enrollment",
      async () => {
        const result = await request("student/course-catalog");
        assert.equal(result.status, 200);
        assert.deepEqual(
          result.body.map((v: any) => v.id),
          [a.id, b.id, e.id],
        );
        assert.deepEqual(
          result.body.map((v: any) => v.enrolled),
          [true, false, true],
        );
        assert.ok(!JSON.stringify(result.body).includes("PRIVATE"));
        assert.ok(!JSON.stringify(result.body).includes("SECRET"));
        assert.ok(result.body.every((v: any) => !v.lessons && !v.versionId));
        assert.deepEqual(
          (await request("student/course-catalog", outsider)).body.map(
            (v: any) => v.id,
          ),
          [d.id],
        );
        assert.equal(
          (await request("student/course-catalog", viewer)).status,
          403,
        );
        assert.equal((await request(`student/courses/${b.id}`)).status, 403);
      },
    );
    await t.test(
      "course reads do not mutate recency; explicit authorized opens sort enrolled courses most recent first",
      async () => {
        assert.deepEqual(
          (await request("student/courses")).body.map((v: any) => v.id),
          [a.id, e.id],
        );
        await request(`student/courses/${e.id}`);
        await request("student/course-catalog");
        assert.equal(
          (
            await scoped(connection.db, { platform: true }, (tx) =>
              tx.select().from(s.courseActivity),
            )
          ).length,
          0,
        );
        assert.equal(
          (await request(`student/courses/${b.id}/opened`, student, "POST", {}))
            .status,
          403,
        );
        const opened = await request(
          `student/courses/${e.id}/opened`,
          student,
          "POST",
          {},
        );
        assert.equal(opened.status, 201);
        assert.ok(opened.body.lastOpenedAt);
        assert.deepEqual(
          (await request("student/courses")).body.map((v: any) => v.id),
          [e.id, a.id],
        );
        await request(`student/courses/${a.id}/opened`, student, "POST", {});
        assert.deepEqual(
          (await request("student/courses")).body.map((v: any) => v.id),
          [a.id, e.id],
        );
        assert.ok(
          (await request("student/courses")).body.every(
            (v: any) => v.lastOpenedAt,
          ),
        );
      },
    );
    await t.test(
      "enrolled cards retain pinned metadata and archived learning while unassigned archives stay hidden",
      async () => {
        const revised = await request(
          `platform/courses/${a.id}/publish`,
          admin,
          "POST",
          {
            title: "A New publication",
            description: "New course description",
            lessons: [
              { title: "New private content", body: "PRIVATE UPDATED LESSON" },
            ],
          },
        );
        assert.equal(revised.status, 201);
        let catalog = await request("student/course-catalog");
        let enrolled = catalog.body.find((item: any) => item.id === a.id);
        assert.equal(enrolled.title, a.title);
        assert.equal(enrolled.description, a.description);
        assert.equal(enrolled.enrolled, true);
        assert.equal(
          (await request("student/course-catalog", peer)).body.find(
            (item: any) => item.id === a.id,
          ).title,
          "A New publication",
        );
        assert.equal(
          (
            await request(`platform/courses/${a.id}`, admin, "PATCH", {
              status: "archived",
            })
          ).status,
          200,
        );
        catalog = await request("student/course-catalog");
        enrolled = catalog.body.find((item: any) => item.id === a.id);
        assert.equal(enrolled.status, "archived");
        assert.equal(enrolled.title, a.title);
        assert.equal(enrolled.enrolled, true);
        assert.ok(!enrolled.lessons && !enrolled.versionId);
        assert.equal(
          (await request(`student/courses/${a.id}`)).body.title,
          a.title,
        );
        assert.ok(
          !(await request("student/course-catalog", peer)).body.some(
            (item: any) => item.id === a.id,
          ),
        );
        assert.equal(
          (
            await request(
              `student/courses/${a.id}/enrollment-requests`,
              peer,
              "POST",
              {},
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `student/courses/${a.id}/enrollment-requests`,
              student,
              "POST",
              {},
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(`platform/courses/${a.id}`, admin, "PATCH", {
              status: "published",
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "request atomically creates durable admin notification and encrypted email without granting access",
      async () => {
        const old = process.env.ENROLLMENT_REQUEST_EMAIL;
        process.env.ENROLLMENT_REQUEST_EMAIL = "admissions@example.test";
        try {
          const result = await request(enrollPath, student, "POST", {});
          assert.equal(result.status, 201);
          requestId = result.body.id;
          const records = await scoped(
            connection.db,
            { platform: true },
            async (tx) => ({
              requests: await tx.select().from(s.enrollmentRequests),
              mail: await tx.select().from(s.outbox),
            }),
          );
          assert.equal(records.requests.length, 1);
          assert.equal(records.mail.length, 1);
          assert.equal(records.requests[0].outboxId, records.mail[0].id);
          assert.ok(
            !records.mail[0].encryptedPayload.includes("catalog-student"),
          );
          const payload = decryptPayload(
            config.secret,
            records.mail[0].encryptedPayload,
            "enrollment_request",
          );
          assert.equal(payload.email, "admissions@example.test");
          assert.equal(payload.studentEmail, "catalog-student@example.test");
          assert.equal(payload.courseTitle, b.title);
          assert.equal(payload.branchCode, "CSE");
          assert.equal((await request(`student/courses/${b.id}`)).status, 403);
          assert.equal(
            (await request("student/course-catalog")).body.find(
              (v: any) => v.id === b.id,
            ).enrollmentRequestStatus,
            "pending",
          );
        } finally {
          if (old === undefined) delete process.env.ENROLLMENT_REQUEST_EMAIL;
          else process.env.ENROLLMENT_REQUEST_EMAIL = old;
        }
      },
    );
    await t.test(
      "concurrent repeated requests reuse one request and one message",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            request(enrollPath, student, "POST", {}),
          ),
        );
        assert.ok(
          results.every((r) => r.status === 201 && r.body.id === requestId),
        );
        assert.equal(
          (
            await scoped(connection.db, { platform: true }, (tx) =>
              tx.select().from(s.enrollmentRequests),
            )
          ).length,
          1,
        );
        assert.equal((await connection.db.select().from(s.outbox)).length, 1);
        assert.equal(
          (
            await request(
              `student/courses/${a.id}/enrollment-requests`,
              student,
              "POST",
              {},
            )
          ).status,
          409,
        );
        for (const id of [c.id, d.id, randomUUID()])
          assert.equal(
            (
              await request(
                `student/courses/${id}/enrollment-requests`,
                student,
                "POST",
                {},
              )
            ).status,
            404,
          );
        assert.equal(
          (await request(enrollPath, outsider, "POST", {})).status,
          404,
        );
      },
    );
    await t.test(
      "admin inbox filters and reviews requests without course access changes; students cannot inspect peers or review",
      async () => {
        let inbox = await request(
          "platform/enrollment-requests?page=1&pageSize=1",
          admin,
        );
        assert.equal(inbox.status, 200);
        assert.equal(inbox.body.total, 1);
        assert.equal(inbox.body.unreadCount, 1);
        assert.equal(inbox.body.items[0].studentName, "catalog-student");
        assert.equal(inbox.body.items[0].enrolled, false);
        assert.equal(
          (await request("platform/enrollment-requests", student)).status,
          403,
        );
        assert.equal(
          (
            await request(
              `platform/enrollment-requests/${requestId}`,
              viewer,
              "PATCH",
              { read: true },
            )
          ).status,
          403,
        );
        assert.deepEqual(
          await scoped(
            connection.db,
            { authId: peer.authUserId, organizationId: org.id },
            (tx) => tx.select().from(s.enrollmentRequests),
          ),
          [],
        );
        const reviewed = await request(
          `platform/enrollment-requests/${requestId}`,
          admin,
          "PATCH",
          { status: "reviewed" },
        );
        assert.equal(reviewed.status, 200);
        assert.ok(reviewed.body.readAt && reviewed.body.reviewedAt);
        assert.equal(reviewed.body.status, "reviewed");
        inbox = await request("platform/enrollment-requests?unread=1", admin);
        assert.equal(inbox.body.total, 0);
        assert.equal(inbox.body.unreadCount, 0);
        assert.equal(
          (
            await request(
              `platform/enrollment-requests?organizationId=${other.id}`,
              admin,
            )
          ).body.total,
          0,
        );
        assert.equal(
          (
            await request(
              "platform/enrollment-requests?q=Available&status=reviewed",
              admin,
            )
          ).body.total,
          1,
        );
        assert.equal(
          (await request("platform/enrollment-requests?q=missing", admin)).body
            .total,
          0,
        );
        assert.equal(
          (await request(enrollPath, student, "POST", {})).body.status,
          "reviewed",
        );
      },
    );
    await t.test(
      "transaction rolls back an email when inbox persistence fails and does not grant access",
      async () => {
        await connection.db.execute(
          sql.raw(
            "CREATE FUNCTION request_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated request failure'; END $$;",
          ),
        );
        await connection.db.execute(
          sql.raw(
            "CREATE TRIGGER request_test_failure BEFORE INSERT ON course_enrollment_requests FOR EACH ROW EXECUTE FUNCTION request_test_failure();",
          ),
        );
        try {
          assert.equal(
            (await request(enrollPath, peer, "POST", {})).status,
            500,
          );
        } finally {
          await connection.db.execute(
            sql.raw(
              "DROP TRIGGER request_test_failure ON course_enrollment_requests;",
            ),
          );
        }
        assert.equal((await connection.db.select().from(s.outbox)).length, 1);
      },
    );
    await t.test(
      "outbox delivers enrollment requests through an injected sender and clears encrypted payload",
      async () => {
        const delivered: any[] = [];
        await deliverOne(connection.db, config.secret, {
          async password_reset() {
            assert.fail();
          },
          async welcome_student() {
            assert.fail();
          },
          async enrollment_request(id, payload) {
            delivered.push({ id, payload });
          },
        });
        assert.equal(delivered.length, 1);
        assert.equal(delivered[0].payload.requestId, requestId);
        const [mail] = await connection.db.select().from(s.outbox);
        assert.equal(mail.status, "accepted");
        assert.equal(mail.encryptedPayload, "");
        assert.equal(
          (await request("platform/enrollment-requests", admin)).body.items[0]
            .emailStatus,
          "accepted",
        );
        const rendered = formatEnrollmentMail({
          ...delivered[0].payload,
          studentName: "<script>unsafe</script>",
        });
        assert.ok(!rendered.html.includes("<script>"));
        assert.ok(rendered.html.includes("&lt;script&gt;"));
      },
    );
    await t.test(
      "admin can create with HTTPS covers and upload verified PNG covers; unsafe or unfinished sources are rejected",
      async () => {
        const fields = {
          title: "Cover test",
          description: "Testing covers",
          track: "general",
        };
        const created = await request("platform/courses", admin, "POST", {
          ...fields,
          coverImageUrl: "https://images.example.test/course.jpg",
        });
        assert.equal(created.status, 201);
        assert.equal(
          created.body.coverImageUrl,
          "https://images.example.test/course.jpg",
        );
        for (const url of [
          "javascript:alert(1)",
          "data:image/png,x",
          "http://images.example.test/a.png",
          "https://user:password@images.example.test/a.png",
        ])
          assert.equal(
            (
              await request("platform/courses", admin, "POST", {
                ...fields,
                coverImageUrl: url,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request("lesson-uploads", student, "POST", {
              purpose: "course_cover",
              fileName: "cover.png",
              contentType: "image/png",
              size: 16,
            })
          ).status,
          403,
        );
        const upload = await request("lesson-uploads", admin, "POST", {
          purpose: "course_cover",
          fileName: "cover.png",
          contentType: "image/png",
          size: 16,
        });
        assert.equal(upload.status, 201);
        coverUploadId = upload.body.upload.id;
        assert.equal(
          (
            await request("platform/courses", admin, "POST", {
              ...fields,
              coverUploadId,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `lesson-uploads/${coverUploadId}/complete`,
              admin,
              "POST",
              {},
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request("platform/courses", admin, "POST", {
              ...fields,
              coverUploadId,
              coverImageUrl: "https://images.example.test/a.png",
            })
          ).status,
          400,
        );
        const publish = await request(
          `platform/courses/${b.id}/publish`,
          admin,
          "POST",
          {
            title: b.title,
            description: b.description,
            coverUploadId,
            lessons: [{ title: "New lesson", body: "PRIVATE CONTENT" }],
          },
        );
        assert.equal(publish.status, 201);
        const discovery = await request("student/course-catalog");
        const card = discovery.body.find((r: any) => r.id === b.id);
        assert.match(
          card.coverImageUrl,
          /https:\/\/storage.example.test\/lesson-assets\/.+signed=1/,
        );
        assert.equal(
          (await request(`lesson-uploads/${coverUploadId}/download`, student))
            .status,
          404,
        );
        assert.equal(
          (await request(`platform/courses/${b.id}`, admin)).body.coverUploadId,
          coverUploadId,
        );
        validImage = false;
        const invalid = await request("lesson-uploads", admin, "POST", {
          purpose: "course_cover",
          fileName: "fake.png",
          contentType: "image/png",
          size: 16,
        });
        assert.equal(
          (
            await request(
              `lesson-uploads/${invalid.body.upload.id}/complete`,
              admin,
              "POST",
              {},
            )
          ).status,
          400,
        );
        validImage = true;
      },
    );
    await t.test(
      "courses feature disable blocks discovery and requests, migration reruns preserve covers and access/progress",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.accessPolicies)
            .set({
              policy: {
                ...inheritPolicy(),
                features: [],
                courseIds: [a.id, e.id],
              },
            })
            .where(eq(s.accessPolicies.targetKey, student.id)),
        );
        assert.equal((await request("student/course-catalog")).status, 403);
        assert.equal(
          (await request(enrollPath, student, "POST", {})).status,
          403,
        );
        await migrateDatabase(connection.db);
        await migrateDatabase(connection.db);
        const after = await scoped(
          connection.db,
          { platform: true },
          async (tx) => ({
            grants: await tx.select().from(s.grants),
            progress: await tx.select().from(s.progress),
          }),
        );
        assert.deepEqual(after, before);
        const [upload] = await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .select()
            .from(s.lessonUploads)
            .where(eq(s.lessonUploads.id, coverUploadId)),
        );
        assert.equal(upload.status, "ready");
        assert.equal(
          (await request("platform/enrollment-requests", admin)).body.total,
          1,
        );
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
