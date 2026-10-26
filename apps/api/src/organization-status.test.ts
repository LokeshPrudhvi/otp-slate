import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { registrationRequests } from "./registration.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("organization archive and restore revoke access while preserving student records", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "organization-status-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173"], port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(connection.db, auth, config, true);
  const [org, other] = await scoped(connection.db, { platform: true }, tx =>
    tx.insert(s.organizations).values([{ name: "Archive College" }, { name: "Other College" }]).returning());
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.organizationBranches).values([{ organizationId: org.id, code: "CSE", name: "Computer Science" }]));
  const password = "Organization-status-tests-only!2026";
  async function signIn(email: string) {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  }
  async function person(name: string, role: "platform_admin" | "student" | "organization_viewer", organizationId: string | null, status = "active") {
    const identity = await auth.api.createUser({ body: {
      name, email: `${name}@example.test`, password, role: role === "platform_admin" ? "admin" : "user",
    } });
    const [member] = await scoped(connection.db, { platform: true }, tx => tx.insert(s.members).values({
      authUserId: identity.user.id, organizationId, role, status,
      passwordSetupComplete: true, phoneVerifiedAt: new Date(),
    }).returning());
    return { ...member, email: identity.user.email, cookie: await signIn(identity.user.email) };
  }
  const admin = await person("archive-admin", "platform_admin", null);
  const student = await person("archive-student", "student", org.id);
  const viewer = await person("archive-viewer", "organization_viewer", org.id);
  const suspended = await person("archive-suspended", "student", org.id, "suspended");
  const foreign = await person("archive-foreign", "student", other.id);
  const course = await scoped(connection.db, { platform: true }, async tx => {
    const [record] = await tx.insert(s.courses).values({ title: "Preserved course", description: "Learning history", track: "general", status: "published" }).returning();
    const lessonId = randomUUID();
    const [version] = await tx.insert(s.versions).values({ courseId: record.id, number: 1, title: record.title, description: record.description, lessons: [{ id: lessonId, title: "Lesson", body: "Content" }] }).returning();
    await tx.insert(s.grants).values({ organizationId: org.id, memberId: student.id, courseId: record.id, versionId: version.id });
    await tx.insert(s.progress).values({ organizationId: org.id, memberId: student.id, versionId: version.id, lessonId });
    return record;
  });
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(path: string, cookie = "", method = "GET", body?: unknown, token = "") {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { Origin: config.origins[0], "Content-Type": "application/json", Cookie: cookie, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  const path = `platform/organizations/${org.id}`;
  const transition = (status: "active" | "archived") => request(path, admin.cookie, "PATCH", { status });
  const sessions = (userId: string) => connection.db.select().from(s.session).where(eq(s.session.userId, userId));
  const audit = () => scoped(connection.db, { platform: true }, tx => tx.select().from(s.audit).where(eq(s.audit.organizationId, org.id)));
  const history = () => scoped(connection.db, { platform: true }, async tx => ({
    members: await tx.select().from(s.members).where(eq(s.members.organizationId, org.id)).orderBy(s.members.id),
    grants: await tx.select().from(s.grants).where(eq(s.grants.organizationId, org.id)),
    progress: await tx.select().from(s.progress).where(eq(s.progress.organizationId, org.id)),
  }));
  const before = await history();
  const pendingInput = { organizationId: org.id, studentId: "ARCHIVE-001", name: "Pending student", email: "archive-pending@example.test", phone: "9876543210", branchName: "Computer Science", branchCode: "CSE", cohort: "2026" };
  const pending = await request("registration/requests", "", "POST", pendingInput);
  assert.equal(pending.status, 201);
  const token = (await auth.api.getToken({ headers: new Headers({ cookie: student.cookie }) })).token;
  let archivedCookie = "";
  try {
    await t.test("only Platform Admin can change organization status with a strict valid request", async () => {
      assert.equal((await request(path, "", "PATCH", { status: "archived" })).status, 401);
      for (const actor of [student, viewer])
        assert.equal((await request(path, actor.cookie, "PATCH", { status: "archived" })).status, 403);
      for (const body of [{}, { status: "deleted" }, { status: "archived", name: "Changed" }])
        assert.equal((await request(path, admin.cookie, "PATCH", body)).status, 400);
      assert.equal((await request(`platform/organizations/${randomUUID()}`, admin.cookie, "PATCH", { status: "archived" })).status, 404);
      assert.equal((await request("me?portal=student", "", "GET", undefined, token)).status, 200);
      assert.equal((await request(`student/courses/${course.id}`, student.cookie)).status, 200);
    });

    await t.test("archiving revokes every target session and blocks new registration and pending approval", async () => {
      const response = await transition("archived");
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "archived");
      assert.equal(response.body.accessRevision, org.accessRevision + 1);
      for (const actor of [student, viewer, suspended]) assert.equal((await sessions(actor.authUserId)).length, 0);
      assert.equal((await request("me?portal=student", student.cookie)).status, 401);
      assert.equal((await request("me?portal=organization", viewer.cookie)).status, 401);
      assert.equal((await request("me?portal=student", "", "GET", undefined, token)).status, 401);
      assert.equal((await request(`student/courses/${course.id}`, student.cookie)).status, 401);
      assert.equal((await request("me?portal=platform", admin.cookie)).status, 200);
      assert.equal((await request("me?portal=student", foreign.cookie)).status, 200);
      const catalog = await request("registration/organizations");
      assert.deepEqual(catalog.body.map((item: { id: string }) => item.id), [other.id]);
      assert.equal((await request("registration/requests", "", "POST", { ...pendingInput, email: "archive-new@example.test", studentId: "ARCHIVE-002" })).status, 400);
      const approval = await request("platform/registrations/approve", admin.cookie, "POST", { ids: [pending.body.id] });
      assert.equal(approval.status, 201);
      assert.equal(approval.body.results[0].status, "failed");
      const [registration] = await scoped(connection.db, { platform: true }, tx => tx.select().from(registrationRequests).where(eq(registrationRequests.id, pending.body.id)));
      assert.equal(registration.status, "pending");
      assert.equal(registration.welcomeOutboxId, null);
      assert.deepEqual(await connection.db.select().from(s.user).where(eq(s.user.email, pendingInput.email)), []);
      assert.deepEqual(await history(), before);
      const [event] = await audit();
      assert.equal(event.action, "organization.archived");
      assert.equal(event.actorId, admin.id);
      assert.equal(event.resourceId, org.id);
    });

    await t.test("repeating archive is a no-op and archived credentials cannot access the portal", async () => {
      archivedCookie = await signIn(student.email);
      assert.equal((await request("me?portal=student", archivedCookie)).status, 403);
      const [session] = await sessions(student.authUserId);
      assert.ok(session);
      const response = await transition("archived");
      assert.equal(response.status, 200);
      assert.equal(response.body.accessRevision, org.accessRevision + 1);
      assert.equal((await audit()).length, 1);
      assert.equal((await sessions(student.authUserId))[0].id, session.id);
    });

    await t.test("restore requires a fresh session, keeps suspensions and history, and is idempotent", async () => {
      const response = await transition("active");
      assert.equal(response.status, 200);
      assert.equal(response.body.status, "active");
      assert.equal(response.body.accessRevision, org.accessRevision + 2);
      for (const cookie of [student.cookie, archivedCookie])
        assert.equal((await request("me?portal=student", cookie)).status, 401);
      assert.equal((await request("me?portal=organization", viewer.cookie)).status, 401);
      assert.equal((await request("me?portal=student", "", "GET", undefined, token)).status, 401);
      const fresh = await signIn(student.email);
      assert.equal((await request(`student/courses/${course.id}`, fresh)).status, 200);
      assert.equal((await request("me?portal=organization", await signIn(viewer.email))).status, 200);
      assert.equal((await request("me?portal=student", await signIn(suspended.email))).status, 403);
      const duplicate = await transition("active");
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.accessRevision, response.body.accessRevision);
      assert.equal(duplicate.body.updatedAt, response.body.updatedAt);
      assert.equal((await request("me?portal=student", fresh)).status, 200);
      assert.equal((await request("me?portal=student", foreign.cookie)).status, 200);
      const catalog = await request("registration/organizations");
      assert.ok(catalog.body.some((item: { id: string }) => item.id === org.id));
      assert.deepEqual(await history(), before);
      assert.deepEqual((await audit()).map(event => event.action).sort(), ["organization.archived", "organization.restored"]);
    });
  } finally {
    await app.close();
    await connection.close();
  }
});
