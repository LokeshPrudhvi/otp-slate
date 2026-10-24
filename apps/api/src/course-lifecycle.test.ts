import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AccessPolicy, AccessWorkspace } from "@slate/contracts";
import { inheritPolicy } from "./access.js";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("course lifecycle protects enrolled learning and permits only safe draft deletion", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "course-lifecycle-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173"], port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(connection.db, auth, config, {
    configured: false, async send() { assert.fail("Course tests must not send external messages."); },
  }, true);
  const [org, legacyOrg] = await scoped(connection.db, { platform: true }, tx =>
    tx.insert(s.organizations).values([{ name: "Policy College" }, { name: "Legacy College" }]).returning());
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.organizationBranches).values([{ organizationId: org.id, code: "CSE", name: "Computer Science" }, { organizationId: org.id, code: "REMOVE", name: "Removal check" }, { organizationId: org.id, code: "NEW", name: "New branch" }]));
  async function person(name: string, role: "platform_admin" | "student" | "organization_viewer", organizationId: string | null, branchCode: string | null = null) {
    const password = "Course-lifecycle-tests-only!2026";
    const identity = await auth.api.createUser({ body: {
      name, email: `${name}@example.test`, password, role: role === "platform_admin" ? "admin" : "user",
    } });
    const [member] = await scoped(connection.db, { platform: true }, tx => tx.insert(s.members).values({
      authUserId: identity.user.id, organizationId, role, branchCode,
      passwordSetupComplete: true, phoneVerifiedAt: new Date(),
    }).returning());
    const signedIn = await auth.api.signInEmail({ body: { email: identity.user.email, password }, asResponse: true });
    assert.equal(signedIn.status, 200);
    return { ...member, cookie: signedIn.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ") };
  }
  const admin = await person("course-admin", "platform_admin", null);
  const viewer = await person("course-viewer", "organization_viewer", org.id);
  const organizationStudent = await person("course-organization", "student", org.id);
  const branchStudent = await person("course-branch", "student", org.id, "CSE");
  const ownStudent = await person("course-own", "student", org.id);
  const legacyStudent = await person("course-legacy", "student", legacyOrg.id);
  const unassigned = await person("course-unassigned", "student", legacyOrg.id);
  const fixture = await scoped(connection.db, { platform: true }, async tx => {
    const [course, unused, withVersion, withGrant, withPolicy] = await tx.insert(s.courses).values([
      { title: "Published learning", description: "Pinned lessons", track: "general", status: "published" },
      { title: "Unused draft", description: "Safe to delete", track: "general" },
      { title: "Draft with version", description: "Keep its version", track: "general" },
      { title: "Draft with grant", description: "Keep its enrollment", track: "general" },
      { title: "Draft with policy", description: "Keep its reference", track: "general" },
    ]).returning();
    const firstLesson = { id: randomUUID(), title: "Pinned lesson", body: "Version one" };
    const additionalLesson = { id: randomUUID(), title: "Continue learning", body: "Another lesson in version one" };
    const laterLesson = { id: randomUUID(), title: "New lesson", body: "Version two" };
    const [first, latest, , enrolledDraftVersion] = await tx.insert(s.versions).values([
      { courseId: course.id, number: 1, title: "Original title", description: course.description, lessons: [firstLesson, additionalLesson] },
      { courseId: course.id, number: 2, title: "Latest title", description: course.description, lessons: [laterLesson] },
      { courseId: withVersion.id, number: 1, title: withVersion.title, description: withVersion.description, lessons: [firstLesson] },
      { courseId: withGrant.id, number: 1, title: withGrant.title, description: withGrant.description, lessons: [firstLesson] },
    ]).returning();
    const policy: AccessPolicy = { features: ["courses"], courseIds: [course.id], practiceModuleIds: [] };
    await tx.insert(s.accessPolicies).values([
      { organizationId: org.id, scope: "organization", targetKey: "organization", policy, courseVersions: { [course.id]: first.id } },
      { organizationId: org.id, scope: "branch", targetKey: "CSE", branchName: "Computer Science", policy: { ...inheritPolicy(), courseIds: [course.id] }, courseVersions: { [course.id]: first.id } },
      { organizationId: org.id, scope: "branch", targetKey: "REMOVE", branchName: "Removal check", policy: { ...inheritPolicy(), courseIds: [course.id] }, courseVersions: { [course.id]: first.id } },
      { organizationId: org.id, scope: "student", targetKey: ownStudent.id, policy: { ...inheritPolicy(), courseIds: [course.id] }, courseVersions: { [course.id]: first.id, [withPolicy.id]: randomUUID() } },
    ]);
    await tx.insert(s.grants).values([
      { organizationId: legacyOrg.id, memberId: legacyStudent.id, courseId: course.id, versionId: first.id },
      { organizationId: legacyOrg.id, memberId: unassigned.id, courseId: withGrant.id, versionId: enrolledDraftVersion.id },
    ]);
    await tx.insert(s.progress).values([organizationStudent, branchStudent, ownStudent, legacyStudent].map(member => ({
      organizationId: member.organizationId!, memberId: member.id, versionId: first.id, lessonId: firstLesson.id,
    })));
    return { course, unused, withVersion, withGrant, withPolicy, first, latest, firstLesson, additionalLesson, policy };
  });
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(path: string, cookie = admin.cookie, method = "GET", body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { Origin: config.origins[0], "Content-Type": "application/json", Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const path = `platform/courses/${fixture.course.id}`;
  const transition = (status: "archived" | "published") => request(path, admin.cookie, "PATCH", { status });
  const workspace = async (organizationId = org.id) => {
    const response = await request(`platform/organizations/${organizationId}/access`);
    assert.equal(response.status, 200);
    return response.body as AccessWorkspace;
  };
  async function policy(scope: "organization" | "branch" | "student", value: AccessPolicy, targetId?: string, organizationId = org.id) {
    const current = await workspace(organizationId);
    return request(`platform/organizations/${organizationId}/access`, admin.cookie, "PUT", {
      revision: current.revision, scope, policy: value, ...(targetId ? { targetId } : {}),
    });
  }
  const history = () => scoped(connection.db, { platform: true }, async tx => ({
    grants: await tx.select().from(s.grants).orderBy(s.grants.id),
    progress: await tx.select().from(s.progress).orderBy(s.progress.id),
    versions: await tx.select().from(s.versions).orderBy(s.versions.id),
  }));
  const before = await history();
  const audit = (courseId: string) => scoped(connection.db, { platform: true }, tx =>
    tx.select().from(s.audit).where(eq(s.audit.resourceId, courseId)));
  async function assertPinnedLearning() {
    for (const student of [organizationStudent, branchStudent, ownStudent, legacyStudent]) {
      const catalog = await request("student/courses", student.cookie);
      assert.equal(catalog.status, 200);
      assert.equal(catalog.body.find((course: { id: string }) => course.id === fixture.course.id)?.versionId, fixture.first.id);
      const detail = await request(`student/courses/${fixture.course.id}`, student.cookie);
      assert.equal(detail.status, 200);
      assert.equal(detail.body.versionId, fixture.first.id);
      assert.deepEqual(detail.body.lessons, [fixture.firstLesson, fixture.additionalLesson]);
      assert.deepEqual(detail.body.completedLessonIds, [fixture.firstLesson.id]);
    }
  }
  try {
    await t.test("course mutation endpoints enforce admin roles, schema, identifiers and lifecycle states", async () => {
      for (const method of ["PATCH", "DELETE"]) {
        const body = method === "PATCH" ? { status: "archived" } : undefined;
        assert.equal((await request(path, "", method, body)).status, 401);
        for (const actor of [viewer, organizationStudent]) assert.equal((await request(path, actor.cookie, method, body)).status, 403);
        assert.equal((await request(`platform/courses/${randomUUID()}`, admin.cookie, method, body)).status, 404);
        assert.equal((await request("platform/courses/not-a-uuid", admin.cookie, method, body)).status, 400);
      }
      for (const body of [{}, { status: "draft" }, { status: "archived", title: "Changed" }])
        assert.equal((await request(path, admin.cookie, "PATCH", body)).status, 400);
      for (const status of ["published", "archived"])
        assert.equal((await request(`platform/courses/${fixture.unused.id}`, admin.cookie, "PATCH", { status })).status, 409);
    });

    await t.test("only unused drafts can be deleted and referenced drafts remain intact", async () => {
      const deleted = await request(`platform/courses/${fixture.unused.id}`, admin.cookie, "DELETE");
      assert.equal(deleted.status, 200);
      assert.deepEqual(deleted.body, { id: fixture.unused.id, deleted: true });
      assert.equal((await request(`platform/courses/${fixture.unused.id}`)).status, 404);
      assert.deepEqual((await audit(fixture.unused.id)).map(event => event.action), ["course.deleted"]);
      for (const course of [fixture.course, fixture.withVersion, fixture.withGrant, fixture.withPolicy]) {
        assert.equal((await request(`platform/courses/${course.id}`, admin.cookie, "DELETE")).status, 409);
        assert.equal((await request(`platform/courses/${course.id}`)).status, 200);
        assert.deepEqual(await audit(course.id), []);
      }
      assert.deepEqual(await history(), before);
    });

    await t.test("archiving preserves all enrollment modes, pins and progress and is idempotent", async () => {
      await assertPinnedLearning();
      const archived = await transition("archived");
      assert.equal(archived.status, 200);
      assert.equal(archived.body.status, "archived");
      const repeated = await transition("archived");
      assert.equal(repeated.status, 200);
      assert.deepEqual(repeated.body, archived.body);
      assert.deepEqual((await audit(fixture.course.id)).map(event => event.action), ["course.archived"]);
      assert.equal((await request(path, admin.cookie, "DELETE")).status, 409);
      const publish = await request(`${path}/publish`, admin.cookie, "POST", {
        title: "Unintended version", description: "Restore before publishing", lessons: [{ title: "Lesson", body: "Content" }],
      });
      assert.equal(publish.status, 409);
      await migrateDatabase(connection.db);
      assert.equal((await request(path)).body.status, "archived");
      assert.equal((await workspace()).catalog.courses.find(course => course.id === fixture.course.id)?.status, "archived");
      await assertPinnedLearning();
      assert.deepEqual(await history(), before);
    });

    await t.test("archived courses reject new explicit selections and legacy assignments", async () => {
      const assignment = await request("platform/assignments", admin.cookie, "POST", { memberId: unassigned.id, courseId: fixture.course.id });
      assert.equal(assignment.status, 400);
      for (const response of [
        await policy("organization", fixture.policy, undefined, legacyOrg.id),
        await policy("branch", { ...inheritPolicy(), courseIds: [fixture.course.id] }, "NEW"),
        await policy("student", { ...inheritPolicy(), courseIds: [fixture.course.id] }, organizationStudent.id),
      ]) assert.equal(response.status, 400);
      assert.deepEqual(await history(), before);
    });

    await t.test("unrelated policy edits retain existing archived selections and inherited access", async () => {
      const organization = await policy("organization", { ...fixture.policy, features: ["courses", "jobs"] });
      assert.equal(organization.status, 200);
      for (const [scope, targetId] of [["branch", "CSE"], ["student", ownStudent.id]] as const) {
        const response = await policy(scope, { ...inheritPolicy(), courseIds: [fixture.course.id], features: ["courses"] }, targetId);
        assert.equal(response.status, 200);
      }
      const inherited = await policy("student", { ...inheritPolicy(), features: ["courses"] }, organizationStudent.id);
      assert.equal(inherited.status, 200);
      assert.equal((await policy("branch", { ...inheritPolicy(), courseIds: [] }, "REMOVE")).status, 200);
      assert.equal((await policy("branch", { ...inheritPolicy(), courseIds: [fixture.course.id] }, "REMOVE")).status, 400);
      await assertPinnedLearning();
      const records = await scoped(connection.db, { platform: true }, tx => tx.select().from(s.accessPolicies).where(eq(s.accessPolicies.organizationId, org.id)));
      const removed = records.find(record => record.scope === "branch" && record.targetKey === "REMOVE")!;
      assert.deepEqual(removed.policy.courseIds, []);
      assert.equal(removed.courseVersions[fixture.course.id], fixture.first.id);
      for (const record of records.filter(record => record.policy.courseIds?.includes(fixture.course.id)))
        assert.equal(record.courseVersions[fixture.course.id], fixture.first.id);
      assert.deepEqual(await history(), before);
    });

    await t.test("restore makes new enrollment available without upgrading existing students' pins", async () => {
      const restored = await transition("published");
      assert.equal(restored.status, 200);
      assert.equal(restored.body.status, "published");
      assert.deepEqual((await transition("published")).body, restored.body);
      assert.deepEqual((await audit(fixture.course.id)).map(event => event.action).sort(), ["course.archived", "course.restored"]);
      const assigned = await request("platform/assignments", admin.cookie, "POST", { memberId: unassigned.id, courseId: fixture.course.id });
      assert.equal(assigned.status, 201);
      assert.equal(assigned.body.versionId, fixture.latest.id);
      assert.equal((await policy("branch", { ...inheritPolicy(), courseIds: [fixture.course.id] }, "NEW")).status, 200);
      await assertPinnedLearning();
    });

    await t.test("existing policy and legacy students can complete more lessons while the course is archived", async () => {
      assert.equal((await transition("archived")).status, 200);
      for (const student of [ownStudent, legacyStudent]) {
        const completed = await request(`student/courses/${fixture.course.id}/lessons/${fixture.additionalLesson.id}/complete`, student.cookie, "POST");
        assert.equal(completed.status, 201);
        assert.deepEqual(completed.body, { completed: true });
        const detail = await request(`student/courses/${fixture.course.id}`, student.cookie);
        assert.equal(detail.status, 200);
        assert.equal(detail.body.status, "archived");
        assert.equal(detail.body.versionId, fixture.first.id);
        assert.deepEqual(detail.body.completedLessonIds.sort(), [fixture.firstLesson.id, fixture.additionalLesson.id].sort());
      }
    });
  } finally {
    await app.close();
    await connection.close();
  }
});
