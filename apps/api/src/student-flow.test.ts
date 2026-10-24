import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AccessPolicy } from "@slate/contracts";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { deliverOne } from "./mail-worker.js";
import { formatWelcomeMail, type WelcomeMailPayload } from "./providers.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("admin-created student completes emailed-password onboarding and accesses only assigned learning", async (t) => {
  // Never loads .env or contacts real mail, phone or database providers.
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "student-flow-tests-only-long-secret-32-characters",
    portalProxySecret: "student-flow-only-proxy-secret-at-least-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173", "http://localhost:5174"], port: 0,
  };
  const previousPortal = process.env.STUDENT_PORTAL_URL;
  process.env.STUDENT_PORTAL_URL = config.origins[0];
  const auth = createAuth(connection.db, config, true);
  const phoneInbox: { phone: string; code: string }[] = [];
  const service = new SlateService(connection.db, auth, config, {
    configured: true,
    async send(phone, code) { phoneInbox.push({ phone, code }); },
  }, true);
  const adminPassword = "Flow-admin-password!2026";
  const administrator = await auth.api.createUser({ body: {
    name: "Flow administrator", email: "flow-admin@example.test", password: adminPassword, role: "admin",
  } });
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.members).values({
    authUserId: administrator.user.id, role: "platform_admin", passwordSetupComplete: true,
  }));
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  let clientNumber = 1;
  class Client {
    cookies = new Map<string, string>();
    readonly ip = `192.0.2.${clientNumber++}`;
    constructor(readonly origin: string) {}
    async request(path: string, method = "GET", body?: unknown) {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: this.origin, "Content-Type": "application/json",
          "x-slate-proxy-key": config.portalProxySecret, "x-slate-client-ip": this.ip,
          Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; ") },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0], index = pair.indexOf("=");
        const key = pair.slice(0, index), value = pair.slice(index + 1);
        if (value) this.cookies.set(key, value); else this.cookies.delete(key);
      }
      return { status: response.status, body: await response.json() as any };
    }
    login(email: string, password: string) {
      return this.request("/api/auth/sign-in/email", "POST", { email, password });
    }
  }
  const admin = new Client(config.origins[1]), student = new Client(config.origins[0]);
  const newPassword = "Flow-student-new-password!2026";
  let organizationId = "", memberId = "", assignedCourse = "", unassignedCourse = "";
  const assignedLesson = randomUUID(), unassignedLesson = randomUUID();
  let message: WelcomeMailPayload;
  const inbox: { id: string; payload: WelcomeMailPayload; text: string }[] = [];
  async function updateAccess(scope: "organization" | "student", policy: AccessPolicy) {
    const path = `/api/v1/platform/organizations/${organizationId}/access`;
    const current = await admin.request(path);
    assert.equal(current.status, 200);
    const updated = await admin.request(path, "PUT", {
      revision: current.body.revision, scope, policy,
      ...(scope === "student" ? { targetId: memberId } : {}),
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
  }
  try {
    await t.test("admin creates the organization, published catalog, student and explicit access without approval", async () => {
      assert.equal((await admin.login(administrator.user.email, adminPassword)).status, 200);
      const organization = await admin.request("/api/v1/platform/organizations", "POST", { name: "Student Flow College" });
      assert.equal(organization.status, 201);
      organizationId = organization.body.id;
      assert.equal((await admin.request(`/api/v1/platform/organizations/${organizationId}/branches`, "POST", { name: "Computer Science", code: "CSE" })).status, 201);
      for (const [title, lessonId] of [["Assigned Python course", assignedLesson], ["Unassigned Java course", unassignedLesson]]) {
        const course = await admin.request("/api/v1/platform/courses", "POST", { title, description: "Flow test course", track: "foundation" });
        assert.equal(course.status, 201);
        const published = await admin.request(`/api/v1/platform/courses/${course.body.id}/publish`, "POST", {
          title, description: "Flow test course", lessons: [{ id: lessonId, title: "First lesson", body: "Learning content" }],
        });
        assert.equal(published.status, 201);
        if (lessonId === assignedLesson) assignedCourse = course.body.id; else unassignedCourse = course.body.id;
      }
      const created = await admin.request("/api/v1/platform/students", "POST", {
        organizationId, studentId: "FLOW-001", name: "Flow Student", email: "flow-student@example.test",
        phone: "+919876543210", branchName: "Computer Science", branchCode: "CSE", cohort: "2026",
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.status, "approved");
      assert.equal(created.body.emailStatus, "pending");
      assert.equal(created.body.temporaryPassword, undefined);
      memberId = created.body.memberId;
      await updateAccess("organization", { features: ["courses", "practice", "compiler"], courseIds: [assignedCourse, unassignedCourse], practiceModuleIds: ["aptitude", "competitive-coding", "reasoning"] });
      await updateAccess("student", { features: ["courses", "practice"], courseIds: [assignedCourse], practiceModuleIds: ["aptitude"] });
    });

    await t.test("outbox worker delivers one complete welcome into the injected mailbox and clears credentials from storage", async () => {
      const transport = {
        async password_reset() { assert.fail("Unexpected password reset email."); },
        async welcome_student(id: string, payload: WelcomeMailPayload) {
          inbox.push({ id, payload, text: formatWelcomeMail(payload).text });
        },
      };
      await deliverOne(connection.db, config.secret, transport);
      await deliverOne(connection.db, config.secret, transport);
      assert.equal(inbox.length, 1);
      message = inbox[0].payload;
      assert.equal(message.email, "flow-student@example.test");
      assert.equal(message.studentId, "FLOW-001");
      assert.equal(message.organizationName, "Student Flow College");
      assert.equal(message.loginUrl, `${config.origins[0]}/login`);
      assert.ok(message.temporaryPassword.length >= 32);
      assert.ok(inbox[0].text.includes(`Temporary password: ${message.temporaryPassword}`));
      const [job] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, inbox[0].id));
      assert.equal(job.status, "accepted");
      assert.equal(job.encryptedPayload, "");
    });

    await t.test("temporary login requires password replacement and blocks learning until phone verification", async () => {
      assert.equal((await student.login(message.email, message.temporaryPassword)).status, 200);
      assert.equal((await student.request("/api/v1/me?portal=student")).body.onboardingStep, "password");
      for (const path of ["student/courses", `student/courses/${assignedCourse}`, "student/practice", "student/compiler"])
        assert.equal((await student.request(`/api/v1/${path}`)).status, 403);
      assert.equal((await student.request("/api/v1/onboarding/password", "POST", {
        currentPassword: message.temporaryPassword, newPassword,
      })).status, 201);
      assert.equal((await student.request("/api/v1/me?portal=student")).body.onboardingStep, "phone");
      assert.equal((await student.request("/api/v1/student/courses")).status, 403);
      assert.equal((await student.request("/api/v1/student/practice")).status, 403);
      const oldPasswordClient = new Client(config.origins[0]);
      assert.equal((await oldPasswordClient.login(message.email, message.temporaryPassword)).status, 401);
    });

    await t.test("student verifies the delivered phone OTP and signs back in with the new password", async () => {
      const challenge = await student.request("/api/v1/onboarding/phone", "POST", { phone: "+919876543210" });
      assert.equal(challenge.status, 201);
      assert.equal(phoneInbox.length, 1);
      assert.equal(phoneInbox[0].phone, "+919876543210");
      const verified = await student.request("/api/v1/onboarding/phone/verify", "POST", {
        challengeId: challenge.body.challengeId, code: phoneInbox[0].code,
      });
      assert.equal(verified.status, 201);
      assert.equal(verified.body.requiresSignIn, true);
      assert.equal((await student.request("/api/v1/student/courses")).status, 401);
      assert.equal((await student.login(message.email, newPassword)).status, 200);
      const identity = await student.request("/api/v1/me?portal=student");
      assert.equal(identity.body.onboardingStep, null);
      assert.equal(identity.body.id, memberId);
      assert.equal(identity.body.organizationId, organizationId);
      assert.deepEqual(identity.body.access.courseIds, [assignedCourse]);
      assert.deepEqual(identity.body.access.practiceModuleIds, []);
      for (const portal of ["platform", "organization"])
        assert.equal((await student.request(`/api/v1/me?portal=${portal}`)).status, 403);
    });

    await t.test("only assigned learning is listed, direct unassigned access is forbidden and progress persists", async () => {
      const courses = await student.request("/api/v1/student/courses");
      assert.equal(courses.status, 200);
      assert.deepEqual(courses.body.map((course: any) => course.id), [assignedCourse]);
      assert.equal((await student.request(`/api/v1/student/courses/${assignedCourse}`)).status, 200);
      assert.equal((await student.request(`/api/v1/student/courses/${unassignedCourse}`)).status, 403);
      assert.equal((await student.request(`/api/v1/student/courses/${unassignedCourse}/lessons/${unassignedLesson}/complete`, "POST")).status, 403);
      assert.equal((await student.request(`/api/v1/student/courses/${assignedCourse}/lessons/${assignedLesson}/complete`, "POST")).status, 201);
      const practice = await student.request("/api/v1/student/practice");
      assert.equal(practice.status, 200);
      // A retired aptitude assignment must not silently grant coding access.
      assert.deepEqual(practice.body, []);
      // There is no practice detail/start API yet. Sample content is returned
      // only by the authorized catalog; compiler/submission access is separate.
      assert.equal((await student.request("/api/v1/student/compiler")).status, 403);
      assert.equal((await student.request("/api/v1/student/submissions", "POST")).status, 403);
      assert.equal((await student.request("/api/v1/platform/students", "POST", {})).status, 403);
      await updateAccess("student", { features: ["courses", "practice"], courseIds: [], practiceModuleIds: [] });
      assert.deepEqual((await student.request("/api/v1/student/courses")).body, []);
      assert.deepEqual((await student.request("/api/v1/student/practice")).body, []);
      assert.equal((await student.request(`/api/v1/student/courses/${assignedCourse}`)).status, 403);
      const retained = await scoped(connection.db, { platform: true }, tx => tx.select().from(s.progress).where(eq(s.progress.memberId, memberId)));
      assert.equal(retained.length, 1);
      assert.equal(retained[0].lessonId, assignedLesson);
    });
  } finally {
    await app.close();
    await connection.close();
    if (previousPortal === undefined) delete process.env.STUDENT_PORTAL_URL;
    else process.env.STUDENT_PORTAL_URL = previousPortal;
  }
});
