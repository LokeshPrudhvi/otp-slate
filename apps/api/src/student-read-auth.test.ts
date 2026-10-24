import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AccessPolicy } from "@slate/contracts";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("student course HTTP reads retain fresh authentication and access checks", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "student-read-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(
    connection.db,
    auth,
    config,
    {
      configured: false,
      async send() {
        assert.fail("Student read tests must not send external messages.");
      },
    },
    true,
  );
  const password = "Student-read-tests-only!2026";
  const identity = await auth.api.createUser({
    body: {
      name: "Course reader",
      email: "course-reader@example.test",
      password,
      role: "user",
    },
  });
  const fixture = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      const [organization] = await tx
        .insert(s.organizations)
        .values({ name: "Student Read College" })
        .returning();
      const [member] = await tx
        .insert(s.members)
        .values({
          authUserId: identity.user.id,
          organizationId: organization.id,
          role: "student",
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning();
      const [course] = await tx
        .insert(s.courses)
        .values({
          title: "Assigned course",
          description: "An assigned course with a pinned published version.",
          track: "general",
          status: "published",
        })
        .returning();
      const lesson = {
        id: randomUUID(),
        title: "Assigned lesson",
        body: "Lesson content",
      };
      const [version] = await tx
        .insert(s.versions)
        .values({
          courseId: course.id,
          number: 1,
          title: course.title,
          description: course.description,
          lessons: [lesson],
        })
        .returning();
      const policy: AccessPolicy = {
        features: ["courses"],
        courseIds: [course.id],
        practiceModuleIds: [],
      };
      const [access] = await tx
        .insert(s.accessPolicies)
        .values({
          organizationId: organization.id,
          scope: "organization",
          targetKey: "organization",
          policy,
          courseVersions: { [course.id]: version.id },
        })
        .returning();
      return { organization, member, course, version, lesson, access, policy };
    },
  );
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const paths = ["student/courses", `student/courses/${fixture.course.id}`];
  async function signIn() {
    const response = await auth.api.signInEmail({
      body: { email: identity.user.email, password },
      asResponse: true,
    });
    assert.equal(response.status, 200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }
  let cookie = await signIn();
  async function request(path: string, sessionCookie = cookie) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      headers: { Origin: config.origins[0], Cookie: sessionCookie },
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  async function assertBoth(status: number) {
    for (const path of paths)
      assert.equal((await request(path)).status, status, path);
  }
  async function sessions() {
    return connection.db
      .select()
      .from(s.session)
      .where(eq(s.session.userId, identity.user.id));
  }
  async function resetSession() {
    await connection.db
      .delete(s.session)
      .where(eq(s.session.userId, identity.user.id));
    cookie = await signIn();
  }
  try {
    await t.test(
      "an active enrolled student receives the assigned course and lesson",
      async () => {
        const list = await request(paths[0]);
        assert.equal(list.status, 200);
        assert.deepEqual(
          list.body.map((course: { id: string }) => course.id),
          [fixture.course.id],
        );
        const detail = await request(paths[1]);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.versionId, fixture.version.id);
        assert.deepEqual(detail.body.lessons, [fixture.lesson]);
      },
    );

    await t.test(
      "missing and freshly revoked sessions cannot read either endpoint",
      async () => {
        for (const path of paths)
          assert.equal((await request(path, "")).status, 401, path);
        await connection.db
          .delete(s.session)
          .where(eq(s.session.userId, identity.user.id));
        await assertBoth(401);
        await resetSession();
        await assertBoth(200);
      },
    );

    for (const kind of ["idle", "absolute"] as const) {
      await t.test(
        `${kind} expiry rejects each course endpoint and removes the expired session`,
        async () => {
          for (const path of paths) {
            await resetSession();
            await connection.db
              .update(s.session)
              .set(
                kind === "idle"
                  ? { updatedAt: new Date(Date.now() - 31 * 60_000) }
                  : {
                      createdAt: new Date(Date.now() - 9 * 3600_000),
                      updatedAt: new Date(),
                    },
              )
              .where(eq(s.session.userId, identity.user.id));
            assert.equal((await sessions()).length, 1);
            assert.equal((await request(path)).status, 401, path);
            assert.equal(
              (await sessions()).length,
              0,
              "Expired sessions must be deleted after rollback.",
            );
          }
          await resetSession();
        },
      );
    }

    await t.test(
      "suspending the student immediately denies both course reads",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ status: "suspended" })
            .where(eq(s.members.id, fixture.member.id)),
        );
        try {
          await assertBoth(403);
        } finally {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.members)
              .set({ status: "active" })
              .where(eq(s.members.id, fixture.member.id)),
          );
        }
        await assertBoth(200);
      },
    );

    await t.test(
      "archiving the organization immediately denies both course reads",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizations)
            .set({ status: "archived" })
            .where(eq(s.organizations.id, fixture.organization.id)),
        );
        try {
          await assertBoth(403);
        } finally {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.organizations)
              .set({ status: "active" })
              .where(eq(s.organizations.id, fixture.organization.id)),
          );
        }
        await assertBoth(200);
      },
    );

    await t.test(
      "a current non-student role cannot reuse a student session to read courses",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ role: "organization_viewer" })
            .where(eq(s.members.id, fixture.member.id)),
        );
        try {
          await assertBoth(403);
        } finally {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.members)
              .set({ role: "student" })
              .where(eq(s.members.id, fixture.member.id)),
          );
        }
        await assertBoth(200);
      },
    );

    for (const step of ["password", "phone"] as const) {
      await t.test(
        `incomplete ${step} onboarding denies both course reads`,
        async () => {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.members)
              .set(
                step === "password"
                  ? { passwordSetupComplete: false }
                  : { phoneVerifiedAt: null },
              )
              .where(eq(s.members.id, fixture.member.id)),
          );
          try {
            await assertBoth(403);
          } finally {
            await scoped(connection.db, { platform: true }, (tx) =>
              tx
                .update(s.members)
                .set({
                  passwordSetupComplete: true,
                  phoneVerifiedAt: new Date(),
                })
                .where(eq(s.members.id, fixture.member.id)),
            );
          }
          await assertBoth(200);
        },
      );
    }

    await t.test(
      "new course and feature restrictions take effect without signing in again",
      async () => {
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.accessPolicies)
            .set({ policy: { ...fixture.policy, courseIds: [] } })
            .where(eq(s.accessPolicies.id, fixture.access.id)),
        );
        try {
          const list = await request(paths[0]);
          assert.equal(list.status, 200);
          assert.deepEqual(list.body, []);
          assert.equal((await request(paths[1])).status, 403);
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.accessPolicies)
              .set({ policy: { ...fixture.policy, features: [] } })
              .where(eq(s.accessPolicies.id, fixture.access.id)),
          );
          await assertBoth(403);
        } finally {
          await scoped(connection.db, { platform: true }, (tx) =>
            tx
              .update(s.accessPolicies)
              .set({ policy: fixture.policy })
              .where(eq(s.accessPolicies.id, fixture.access.id)),
          );
        }
        await assertBoth(200);
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
