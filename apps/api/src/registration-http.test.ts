import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { decryptPayload } from "./providers.js";
import { registrationRequests } from "./registration.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("registration HTTP endpoints enforce approval, request limits, portal origins and onboarding", async t => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "http-registration-test-only-secret-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"], port: 0,
  };
  const previousPortal = process.env.STUDENT_PORTAL_URL;
  process.env.STUDENT_PORTAL_URL = config.origins[0];
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(connection.db, auth, config, { configured: false, async send() { assert.fail("No real transport in HTTP tests."); } }, true);
  const adminIdentity = await auth.api.createUser({ body: { email: "http-admin@example.test", name: "Admin", password: "Test-admin-only-password!2026", role: "admin" } });
  const viewerIdentity = await auth.api.createUser({ body: { email: "http-viewer@example.test", name: "Viewer", password: "Test-viewer-only-password!2026", role: "user" } });
  const organizationId = await scoped(connection.db, { platform: true }, async tx => {
    const [org] = await tx.insert(s.organizations).values({ name: "HTTP College" }).returning();
    await tx.insert(s.members).values([
      { authUserId: adminIdentity.user.id, role: "platform_admin", passwordSetupComplete: true },
      { authUserId: viewerIdentity.user.id, role: "organization_viewer", organizationId: org.id, passwordSetupComplete: true },
    ]);
    return org.id;
  });
  async function signIn(email: string, password: string) {
    const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  }
  const adminCookie = await signIn("http-admin@example.test", "Test-admin-only-password!2026");
  const viewerCookie = await signIn("http-viewer@example.test", "Test-viewer-only-password!2026");
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const request = async (path: string, method = "GET", body?: unknown, cookie = "", origin = config.origins[0]) => {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as Record<string, any> };
  };
  const input = { organizationId, studentId: "HTTP-001", name: "HTTP Student", email: "http-student@example.test", phone: "9876543210", branchName: "Computer Science", branchCode: "CSE", cohort: "2026" };
  let id = "";
  try {
    await t.test("public form stages no identity, returns no session and protects writes by origin", async () => {
      const catalog = await request("registration/organizations");
      assert.equal(catalog.status, 200);
      assert.deepEqual(catalog.body, [{ id: organizationId, name: "HTTP College" }]);
      assert.equal((await request("registration/requests", "POST", input, "", "https://unknown.example.test")).status, 403);
      assert.equal((await request("registration/requests", "POST", { ...input, role: "platform_admin" })).status, 400);
      assert.equal((await request("registration/requests", "POST", { ...input, branchName: "" })).status, 400);
      const receipt = await request("registration/requests", "POST", input);
      assert.equal(receipt.status, 201);
      assert.equal(receipt.body.status, "pending");
      assert.equal(receipt.headers.getSetCookie().length, 0);
      assert.deepEqual(Object.keys(receipt.body).sort(), ["id", "status"]);
      id = receipt.body.id;
      assert.deepEqual(await connection.db.select().from(s.user).where(eq(s.user.email, input.email)), []);
      assert.equal((await request("registration/requests", "POST", input)).status, 409);
    });
    await t.test("only Platform Admin can list, approve, reject, import or retry invitations", async () => {
      const routes: [string, string, unknown?][] = [
        ["platform/registrations", "GET"],
        ["platform/registrations/approve", "POST", { ids: [id] }],
        [`platform/registrations/${id}/reject`, "POST", { reason: "No" }],
        ["platform/registrations/import", "POST", { organizationId, rows: [{}] }],
        [`platform/registrations/${id}/retry-email`, "POST", {}],
      ];
      for (const [path, method, body] of routes) {
        assert.equal((await request(path, method, body)).status, 401);
        assert.equal((await request(path, method, body, viewerCookie)).status, 403);
      }
    });
    await t.test("batch validation caps imports and approvals before processing", async () => {
      assert.equal((await request("platform/registrations/approve", "POST", { ids: [id, id] }, adminCookie)).status, 400);
      assert.equal((await request("platform/registrations/approve", "POST", { ids: Array.from({ length: 26 }, () => randomUUID()) }, adminCookie)).status, 400);
      assert.equal((await request("platform/registrations/import", "POST", { organizationId, rows: Array(501).fill({}) }, adminCookie)).status, 400);
      assert.equal((await request("platform/registrations/import", "POST", { organizationId, rows: [] }, adminCookie)).status, 400);
      assert.equal((await request("platform/registrations?status=active", "GET", undefined, adminCookie)).status, 400);
    });
    await t.test("a provisioned viewer's temporary password opens only the organization portal", async () => {
      const email = "http-provisioned-viewer@example.test";
      const created = await request("platform/members", "POST", {
        organizationId, name: "Provisioned viewer", email, role: "organization_viewer",
      }, adminCookie);
      assert.equal(created.status, 201);
      assert.equal(typeof created.body.temporaryPassword, "string");
      const cookie = await signIn(email, created.body.temporaryPassword);
      const me = await request("me?portal=organization", "GET", undefined, cookie);
      assert.equal(me.status, 200);
      assert.equal(me.body.role, "organization_viewer");
      assert.equal(me.body.onboardingStep, "password");
      for (const portal of ["student", "platform"]) {
        const wrongPortal = await request(`me?portal=${portal}`, "GET", undefined, cookie);
        assert.equal(wrongPortal.status, 403);
        assert.match(wrongPortal.body.message, /organization viewer account.*Organization Admin portal/);
      }
    });
    await t.test("approved login is usable only for onboarding until the student sets a password and verifies a phone", async () => {
      const approved = await request("platform/registrations/approve", "POST", { ids: [id] }, adminCookie);
      assert.equal(approved.status, 201);
      assert.deepEqual(approved.body.results, [{ id, status: "approved" }]);
      const [row] = await scoped(connection.db, { platform: true }, tx => tx.select().from(registrationRequests).where(eq(registrationRequests.id, id)));
      const [job] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, row.welcomeOutboxId!));
      const payload = decryptPayload(config.secret, job.encryptedPayload, "welcome_student");
      assert.ok(!JSON.stringify(approved.body).includes(payload.temporaryPassword));
      const studentCookie = await signIn(payload.email, payload.temporaryPassword);
      const me = await request("me?portal=student", "GET", undefined, studentCookie);
      assert.equal(me.status, 200);
      assert.equal(me.body.role, "student");
      assert.equal(me.body.onboardingStep, "password");
      for (const portal of ["organization", "platform"]) {
        const wrongPortal = await request(`me?portal=${portal}`, "GET", undefined, studentCookie);
        assert.equal(wrongPortal.status, 403);
        assert.match(wrongPortal.body.message, /student account.*Student portal/);
      }
      assert.equal((await request("student/courses", "GET", undefined, studentCookie)).status, 403);
      const list = await request("platform/registrations?status=approved", "GET", undefined, adminCookie);
      assert.equal(list.status, 200);
      assert.equal(list.body[0].emailStatus, "pending");
      assert.ok(!JSON.stringify(list.body).includes(payload.temporaryPassword));
      assert.equal((await request("platform/registrations/approve", "POST", { ids: [id] }, adminCookie)).body.results[0].status, "already_approved");
    });
    await t.test("adding one student stages the complete form and sends credentials only after explicit approval", async () => {
      const row = {
        studentId: "HTTP-MANUAL-001", name: "Manually added student", email: "manual-student@example.test",
        phone: "9123456789", branchName: "Mechanical Engineering", branchCode: "me", cohort: "2027",
        collegeName: "HTTP College",
      };
      const importOne = (fields: unknown, selectedOrganization = organizationId, cookie = adminCookie) =>
        request("platform/registrations/import", "POST", { organizationId: selectedOrganization, rows: [fields] }, cookie);
      const mailIds = () => connection.db.select({ id: s.outbox.id }).from(s.outbox).orderBy(s.outbox.id);
      const beforeMail = await mailIds();
      const staged = await importOne(row);
      assert.equal(staged.status, 201);
      const registrationId = staged.body.results[0].id;
      assert.equal(typeof registrationId, "string");
      assert.deepEqual(staged.body, { created: 1, results: [{ row: 1, id: registrationId, status: "pending" }] });
      assert.equal(staged.headers.getSetCookie().length, 0);
      assert.deepEqual(await connection.db.select().from(s.user).where(eq(s.user.email, row.email)), []);
      assert.deepEqual(await mailIds(), beforeMail);
      const readRegistration = async () => (await scoped(connection.db, { platform: true }, tx =>
        tx.select().from(registrationRequests).where(eq(registrationRequests.id, registrationId))))[0];
      const pending = await readRegistration();
      assert.equal(pending.status, "pending");
      assert.equal(pending.memberId, null);
      assert.equal(pending.welcomeOutboxId, null);
      const { collegeName, ...studentFields } = row;
      assert.deepEqual({
        organizationId: pending.organizationId, studentId: pending.studentId, name: pending.name,
        email: pending.email, phone: pending.phone, branchName: pending.branchName,
        branchCode: pending.branchCode, cohort: pending.cohort,
      }, { organizationId, ...studentFields, phone: "+919123456789", branchCode: "ME" });

      const approved = await request("platform/registrations/approve", "POST", { ids: [registrationId] }, adminCookie);
      assert.equal(approved.status, 201);
      assert.deepEqual(approved.body, { results: [{ id: registrationId, status: "approved" }] });
      const complete = await readRegistration();
      const [mail] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, complete.welcomeOutboxId!));
      assert.equal(mail.type, "welcome_student");
      assert.equal(mail.status, "pending");
      assert.ok(!mail.encryptedPayload.includes(row.email));
      const welcome = decryptPayload(config.secret, mail.encryptedPayload, "welcome_student");
      assert.equal(welcome.email, row.email);
      assert.equal(welcome.studentId, row.studentId);
      assert.equal(welcome.organizationName, collegeName);
      assert.equal(welcome.loginUrl, `${config.origins[0]}/login`);
      assert.ok(welcome.temporaryPassword.length >= 32);
      assert.ok(!JSON.stringify(approved.body).includes(welcome.temporaryPassword));
      const studentCookie = await signIn(welcome.email, welcome.temporaryPassword);
      const me = await request("me?portal=student", "GET", undefined, studentCookie);
      assert.equal(me.status, 200);
      assert.equal(me.body.role, "student");
      assert.equal(me.body.organizationId, organizationId);
      assert.equal(me.body.onboardingStep, "password");
      assert.equal((await importOne(row, organizationId, studentCookie)).status, 403);
    });
    await t.test("single-student creation cannot replace viewer accounts or enroll into an archived or mismatched college", async () => {
      const row = { studentId: "HTTP-MANUAL-002", name: "New student", email: "manual-other@example.test", phone: "9123456790", branchName: "Computer Science", branchCode: "CSE", collegeName: "HTTP College" };
      const importOne = (fields: unknown, selectedOrganization = organizationId) =>
        request("platform/registrations/import", "POST", { organizationId: selectedOrganization, rows: [fields] }, adminCookie);
      const mismatch = await importOne({ ...row, collegeName: "Another college" });
      assert.equal(mismatch.body.created, 0);
      assert.equal(mismatch.body.results[0].status, "invalid");
      assert.match(mismatch.body.results[0].message, /College name must match/);
      const duplicate = await importOne({ ...row, email: viewerIdentity.user.email });
      assert.equal(duplicate.body.created, 0);
      assert.equal(duplicate.body.results[0].status, "duplicate");
      const viewer = await request("me?portal=organization", "GET", undefined, viewerCookie);
      assert.equal(viewer.status, 200);
      assert.equal(viewer.body.role, "organization_viewer");
      const [archived] = await scoped(connection.db, { platform: true }, tx =>
        tx.insert(s.organizations).values({ name: "Archived college", status: "archived" }).returning());
      const blocked = await importOne({ ...row, collegeName: archived.name }, archived.id);
      assert.equal(blocked.body.created, 0);
      assert.equal(blocked.body.results[0].status, "invalid");
      assert.match(blocked.body.results[0].message, /active organization/);
      const requests = await scoped(connection.db, { platform: true }, tx =>
        tx.select().from(registrationRequests).where(eq(registrationRequests.studentId, row.studentId)));
      assert.deepEqual(requests, []);
    });
  } finally {
    await app.close();
    await connection.close();
    if (previousPortal === undefined) delete process.env.STUDENT_PORTAL_URL;
    else process.env.STUDENT_PORTAL_URL = previousPortal;
  }
});
