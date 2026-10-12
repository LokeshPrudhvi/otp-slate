import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { inheritPolicy } from "./access.js";
import { registrationRequests } from "./registration.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("branch editing atomically preserves audiences, access and progress with stale-write and tenant protection", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "branch-edit-tests-only-secret-32-characters",
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
        assert.fail("Branch editing must not send mail or phone messages.");
      },
    },
    true,
  );
  const [org, other, archived] = await scoped(
    connection.db,
    { platform: true },
    (tx) =>
      tx
        .insert(s.organizations)
        .values([
          { name: "Edit College" },
          { name: "Other Edit College" },
          { name: "Archived Edit College", status: "archived" },
        ])
        .returning(),
  );
  async function person(
    name: string,
    role: "platform_admin" | "organization_viewer" | "student",
    organizationId: string | null,
    status = "active",
  ) {
    const identity = await auth.api.createUser({
      body: {
        name,
        email: `${name}@example.test`,
        password: "Branch-edit-tests-password!2026",
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: identity.user.id,
          organizationId,
          role,
          status,
          branchCode: role === "student" ? "CSE" : null,
          branchName: role === "student" ? "Computer Science" : null,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    const response = await auth.api.signInEmail({
      body: {
        email: identity.user.email,
        password: "Branch-edit-tests-password!2026",
      },
      asResponse: true,
    });
    return {
      ...member,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }
  const admin = await person("edit-admin", "platform_admin", null);
  const viewer = await person("edit-viewer", "organization_viewer", org.id);
  const student = await person("edit-student", "student", org.id);
  const suspended = await person(
    "edit-suspended",
    "student",
    org.id,
    "suspended",
  );
  const overridden = await person("edit-overridden", "student", org.id);
  const foreign = await person("edit-foreign", "student", other.id);
  const fixture = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      await tx.insert(s.organizationBranches).values([
        { organizationId: org.id, code: "CSE", name: "Computer Science" },
        { organizationId: org.id, code: "ME", name: "Mechanical" },
        { organizationId: other.id, code: "CSE", name: "Computer Science" },
        { organizationId: other.id, code: "FOREIGN", name: "Foreign branch" },
        { organizationId: archived.id, code: "CSE", name: "Computer Science" },
      ]);
      const [course] = await tx
        .insert(s.courses)
        .values({
          title: "Pinned branch course",
          description: "Preserve progression",
          status: "published",
          track: "general",
        })
        .returning();
      const lesson = {
        id: randomUUID(),
        title: "Already completed",
        body: "Version one content",
      };
      const [version, latest] = await tx
        .insert(s.versions)
        .values([
          {
            courseId: course.id,
            number: 1,
            title: course.title,
            description: course.description,
            lessons: [lesson],
          },
          {
            courseId: course.id,
            number: 2,
            title: course.title,
            description: course.description,
            lessons: [{ ...lesson, body: "Version two" }],
          },
        ])
        .returning();
      await tx
        .insert(s.grants)
        .values({
          organizationId: org.id,
          memberId: student.id,
          courseId: course.id,
          versionId: version.id,
        });
      await tx
        .insert(s.progress)
        .values({
          organizationId: org.id,
          memberId: student.id,
          versionId: version.id,
          lessonId: lesson.id,
        });
      await tx.insert(s.accessPolicies).values([
        {
          organizationId: org.id,
          scope: "organization",
          targetKey: "organization",
          policy: { ...inheritPolicy(), courseIds: [course.id] },
          courseVersions: { [course.id]: latest.id },
        },
        {
          organizationId: org.id,
          scope: "branch",
          targetKey: "CSE",
          branchName: "Computer Science",
          policy: {
            features: ["courses", "practice", "announcements"],
            courseIds: [course.id],
            practiceModuleIds: ["aptitude"],
            toolkitTrackIds: [],
          },
          courseVersions: { [course.id]: version.id },
        },
        {
          organizationId: org.id,
          scope: "student",
          targetKey: overridden.id,
          policy: { ...inheritPolicy(), courseIds: [] },
        },
        {
          organizationId: other.id,
          scope: "branch",
          targetKey: "CSE",
          branchName: "Computer Science",
          policy: inheritPolicy(),
        },
      ]);
      const [mail] = await tx
        .insert(s.outbox)
        .values({
          type: "welcome_student",
          encryptedPayload: "unchanged-private-fixture",
          status: "accepted",
          expiresAt: new Date(Date.now() + 3600000),
        })
        .returning();
      await tx.insert(registrationRequests).values(
        ["pending", "approved", "rejected"].map((status, index) => ({
          organizationId: org.id,
          studentId: `EDIT-${index}`,
          name: `Registration ${index}`,
          email: `edit-request-${index}@example.test`,
          phone: "+919876543210",
          branchCode: "CSE",
          branchName: "Computer Science",
          source: "registration",
          status,
          ...(status === "approved"
            ? {
                memberId: student.id,
                welcomeOutboxId: mail.id,
                reviewedBy: admin.id,
                reviewedAt: new Date(),
              }
            : {}),
          ...(status === "rejected"
            ? {
                reviewedBy: admin.id,
                reviewedAt: new Date(),
                rejectionReason: "Test history",
              }
            : {}),
        })),
      );
      await tx.insert(s.announcements).values([
        {
          organizationId: org.id,
          clientId: randomUUID(),
          branchCode: "CSE",
          branchName: "Computer Science",
          title: "Branch notice",
          body: "Keep audience",
          format: "plain" as const,
          createdBy: admin.id,
          authorName: "Admin",
        },
        {
          organizationId: org.id,
          clientId: randomUUID(),
          branchCode: "CSE",
          branchName: "Computer Science",
          title: "Archived notice",
          body: "Keep audience",
          format: "plain" as const,
          status: "archived" as const,
          createdBy: admin.id,
          authorName: "Admin",
        },
        {
          organizationId: org.id,
          clientId: randomUUID(),
          branchCode: null,
          branchName: null,
          title: "All students",
          body: "Keep audience",
          format: "plain" as const,
          createdBy: admin.id,
          authorName: "Admin",
        },
        {
          organizationId: other.id,
          clientId: randomUUID(),
          branchCode: "CSE",
          branchName: "Computer Science",
          title: "Foreign notice",
          body: "Foreign audience",
          format: "plain" as const,
          createdBy: admin.id,
          authorName: "Admin",
        },
      ]);
      return { course, version, lesson };
    },
  );
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  t.after(async () => {
    await app.close();
    await connection.close();
  });
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    cookie = admin.cookie,
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
  const workspace = async (organizationId = org.id) =>
    (await request(`platform/organizations/${organizationId}/access`)).body;
  const path = (code: string, organizationId = org.id) =>
    `platform/organizations/${organizationId}/branches/${encodeURIComponent(code)}`;
  const edit = async (original: string, code: string, name: string) =>
    request(path(original), "PATCH", {
      code,
      name,
      revision: (await workspace()).revision,
    });
  const stored = () =>
    scoped(connection.db, { platform: true }, async (tx) => ({
      branches: await tx
        .select()
        .from(s.organizationBranches)
        .orderBy(
          s.organizationBranches.organizationId,
          s.organizationBranches.code,
        ),
      members: await tx.select().from(s.members).orderBy(s.members.id),
      requests: await tx
        .select()
        .from(registrationRequests)
        .orderBy(registrationRequests.id),
      policies: await tx
        .select()
        .from(s.accessPolicies)
        .orderBy(s.accessPolicies.id),
      notices: await tx
        .select()
        .from(s.announcements)
        .orderBy(s.announcements.id),
      grants: await tx.select().from(s.grants),
      progress: await tx.select().from(s.progress),
      outbox: await tx.select().from(s.outbox),
      audit: await tx.select().from(s.audit).orderBy(s.audit.createdAt),
      organizations: await tx
        .select()
        .from(s.organizations)
        .orderBy(s.organizations.id),
    }));
  const original = await stored();
  const beforeAccess = (
    await request("me?portal=student", "GET", undefined, student.cookie)
  ).body.access;
  const beforeNotices = (
    await request("student/announcements", "GET", undefined, student.cookie)
  ).body
    .map((row: { id: string }) => row.id)
    .sort();
  await t.test(
    "only platform admin can edit with exact scope, required revision and non-colliding identifiers",
    async () => {
      const payload = { name: "Renamed", code: "CS", revision: 0 };
      assert.equal(
        (await request(path("CSE"), "PATCH", payload, "")).status,
        401,
      );
      for (const person of [viewer, student])
        assert.equal(
          (await request(path("CSE"), "PATCH", payload, person.cookie)).status,
          403,
        );
      assert.equal(
        (await request(path("CSE"), "PATCH", { name: "Renamed", code: "CS" }))
          .status,
        400,
      );
      assert.equal(
        (
          await request(path("CSE"), "PATCH", {
            ...payload,
            organizationId: other.id,
          })
        ).status,
        400,
      );
      assert.equal(
        (await request(path("CSE"), "PATCH", { ...payload, code: "<bad>" }))
          .status,
        400,
      );
      assert.equal(
        (await request(path("FOREIGN"), "PATCH", payload)).status,
        409,
      );
      assert.equal(
        (await request(path("CSE", archived.id), "PATCH", payload)).status,
        400,
      );
      assert.equal((await edit("CSE", "me", "Renamed")).status, 409);
      assert.equal((await edit("CSE", "CS", "mechanical")).status, 409);
      assert.deepEqual(await stored(), original);
    },
  );
  await t.test(
    "name-only edit updates every student status, registration state and branch notice without touching learning",
    async () => {
      const result = await edit(
        "CSE",
        "CSE",
        " Computer  Science and Engineering ",
      );
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.deepEqual(result.body, {
        organizationId: org.id,
        code: "CSE",
        name: "Computer Science and Engineering",
      });
      const after = await stored();
      assert.equal(
        after.branches.find(
          (row) => row.organizationId === org.id && row.code === "CSE",
        )!.id,
        original.branches.find(
          (row) => row.organizationId === org.id && row.code === "CSE",
        )!.id,
      );
      for (const member of after.members.filter((row) =>
        [student.id, suspended.id, overridden.id].includes(row.id),
      ))
        assert.equal(member.branchName, "Computer Science and Engineering");
      for (const row of after.requests)
        assert.equal(row.branchName, "Computer Science and Engineering");
      assert.deepEqual(after.grants, original.grants);
      assert.deepEqual(after.progress, original.progress);
      assert.deepEqual(after.outbox, original.outbox);
      assert.deepEqual(
        after.members.find((row) => row.id === foreign.id),
        original.members.find((row) => row.id === foreign.id),
      );
      assert.deepEqual(
        after.policies.filter(
          (row) => row.scope !== "branch" || row.organizationId !== org.id,
        ),
        original.policies.filter(
          (row) => row.scope !== "branch" || row.organizationId !== org.id,
        ),
      );
      for (const notice of after.notices.filter(
        (row) => row.organizationId === org.id && row.branchCode,
      ))
        assert.equal(notice.branchName, "Computer Science and Engineering");
      assert.deepEqual(
        after.notices.filter(
          (row) => row.organizationId !== org.id || !row.branchCode,
        ),
        original.notices.filter(
          (row) => row.organizationId !== org.id || !row.branchCode,
        ),
      );
      const audit = after.audit.find((row) => row.action === "branch.updated")!;
      assert.deepEqual(audit.details, {
        branchId: after.branches.find(
          (row) => row.organizationId === org.id && row.code === "CSE",
        )!.id,
        before: { code: "CSE", name: "Computer Science" },
        after: { code: "CSE", name: "Computer Science and Engineering" },
      });
      const noop = await stored();
      assert.equal(
        (await edit("CSE", "CSE", "Computer Science and Engineering")).status,
        200,
      );
      assert.deepEqual(
        await stored(),
        noop,
        "no-op must not create audit events or revision churn",
      );
    },
  );
  await t.test(
    "code edit accepts encoded slash, preserves branch policy identity and pins, and moves student audiences immediately",
    async () => {
      const result = await edit(
        "CSE",
        "cs/2027",
        "Computer Science and Engineering",
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.code, "CS/2027");
      const after = await stored();
      for (const member of after.members.filter(
        (row) => row.organizationId === org.id && row.role === "student",
      ))
        assert.equal(member.branchCode, "CS/2027");
      for (const row of after.requests) assert.equal(row.branchCode, "CS/2027");
      const beforePolicy = original.policies.find(
        (row) => row.scope === "branch" && row.organizationId === org.id,
      )!;
      const afterPolicy = after.policies.find(
        (row) => row.id === beforePolicy.id,
      )!;
      assert.equal(afterPolicy.targetKey, "CS/2027");
      assert.deepEqual(afterPolicy.policy, beforePolicy.policy);
      assert.deepEqual(afterPolicy.courseVersions, beforePolicy.courseVersions);
      const access = (
        await request("me?portal=student", "GET", undefined, student.cookie)
      ).body.access;
      assert.deepEqual(
        { ...access, revision: beforeAccess.revision },
        beforeAccess,
      );
      const course = await request(
        `student/courses/${fixture.course.id}`,
        "GET",
        undefined,
        student.cookie,
      );
      assert.equal(course.status, 200);
      assert.equal(course.body.versionId, fixture.version.id);
      assert.deepEqual(course.body.completedLessonIds, [fixture.lesson.id]);
      const notices = await request(
        "student/announcements",
        "GET",
        undefined,
        student.cookie,
      );
      assert.deepEqual(
        notices.body.map((row: { id: string }) => row.id).sort(),
        beforeNotices,
      );
      assert.equal(
        notices.body.find(
          (row: { branchCode: string | null }) => row.branchCode,
        )?.branchCode,
        "CS/2027",
      );
      assert.deepEqual(after.grants, original.grants);
      assert.deepEqual(after.progress, original.progress);
      assert.deepEqual(after.outbox, original.outbox);
      const publicBranches = await request(
        `registration/organizations/${org.id}/branches`,
        "GET",
        undefined,
        "",
      );
      assert.equal(
        publicBranches.body.some((row: { code: string }) => row.code === "CSE"),
        false,
      );
      assert.equal(
        (await edit("CS/2027", "CS/2027", "Computer Science and Engineering"))
          .status,
        200,
        "encoded original slash must route correctly",
      );
    },
  );
  await t.test(
    "stale revision or code cannot recreate old policy or overwrite the edited branch",
    async () => {
      const before = await stored();
      assert.equal(
        (
          await request(path("CSE"), "PATCH", {
            revision: 0,
            name: "Stale",
            code: "CSE",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(path("CSE"), "PATCH", {
            revision: (await workspace()).revision,
            name: "Stale",
            code: "CSE",
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`platform/organizations/${org.id}/access`, "PUT", {
            revision: 0,
            scope: "branch",
            targetId: "CSE",
            policy: inheritPolicy(),
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(`platform/organizations/${org.id}/access`, "PUT", {
            revision: (await workspace()).revision,
            scope: "branch",
            targetId: "CSE",
            policy: inheritPolicy(),
          })
        ).status,
        400,
      );
      assert.deepEqual(await stored(), before);
    },
  );
  await t.test(
    "retired codes cannot be claimed by a different branch but the original branch may restore one",
    async () => {
      assert.equal(
        (
          await request(`platform/organizations/${org.id}/branches`, "POST", {
            code: "CSE",
            name: "Different branch",
          })
        ).status,
        409,
      );
      assert.equal((await edit("ME", "CSE", "Mechanical")).status, 409);
      assert.equal(
        (await edit("CS/2027", "CSE", "Computer Science and Engineering"))
          .status,
        200,
      );
      assert.equal(
        (
          await request(`platform/organizations/${org.id}/branches`, "POST", {
            code: "CS/2027",
            name: "Different branch",
          })
        ).status,
        409,
      );
      assert.equal(
        (await edit("CSE", "CS/2027", "Computer Science and Engineering"))
          .status,
        200,
      );
    },
  );
  await t.test(
    "a failed dependent update rolls back the entire rename and creates no audit or email",
    async () => {
      await connection.db.execute(
        sql.raw(
          `CREATE FUNCTION branch_edit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test dependent failure'; END $$`,
        ),
      );
      await connection.db.execute(
        sql.raw(
          `CREATE TRIGGER branch_edit_failure BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION branch_edit_failure()`,
        ),
      );
      const before = await stored();
      assert.equal(
        (await edit("CS/2027", "ROLLBACK", "Rollback check")).status,
        500,
      );
      assert.deepEqual(await stored(), before);
      await connection.db.execute(
        sql.raw(`DROP TRIGGER branch_edit_failure ON announcements`),
      );
      await connection.db.execute(
        sql.raw(`DROP FUNCTION branch_edit_failure()`),
      );
    },
  );
  await t.test(
    "database roles cannot rename across tenants or mutate the stable branch identity",
    async () => {
      const before = await stored();
      assert.deepEqual(await scoped(connection.db, { authId: student.authUserId, organizationId: org.id }, tx => tx.update(s.organizationBranches).set({ name: "Forbidden" }).where(eq(s.organizationBranches.organizationId, org.id)).returning()), []);
      await assert.rejects(scoped(connection.db, { authId: viewer.authUserId, organizationId: org.id, readonly: true }, tx => tx.update(s.organizationBranches).set({ name: "Forbidden" }).where(eq(s.organizationBranches.organizationId, org.id)).returning()));
      await assert.rejects(
        scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizationBranches)
            .set({ id: randomUUID() })
            .where(eq(s.organizationBranches.organizationId, org.id)),
        ),
      );
      await assert.rejects(
        connection.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE slate_registration`);
          await tx.execute(
            sql`select set_config('slate.org_id', ${org.id}, true), set_config('slate.is_platform','false',true)`,
          );
          await tx.update(s.organizationBranches).set({ code: "FORBIDDEN" });
        }),
      );
      assert.deepEqual(await stored(), before);
    },
  );
});
