import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { inheritPolicy } from "./access.js";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { deliverOne } from "./mail-worker.js";
import { decryptPayload } from "./providers.js";
import { registrationRequests } from "./registration.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("Platform Admin can provision and correct students without changing identities or learning history", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "student-management-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173"], port: 0,
  };
  const previousPortal = process.env.STUDENT_PORTAL_URL;
  process.env.STUDENT_PORTAL_URL = config.origins[0];
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(connection.db, auth, config, {
    configured: false, async send() { assert.fail("Student management tests must not send external messages."); },
  }, true);
  const [org, otherOrg, archivedOrg] = await scoped(connection.db, { platform: true }, tx =>
    tx.insert(s.organizations).values([{ name: "Management College" }, { name: "Other College" }, { name: "Archived College", status: "archived" }]).returning());
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.organizationBranches).values([org, otherOrg, archivedOrg].flatMap(organization => [{ organizationId: organization.id, code: "CSE", name: "Computer Science" }, { organizationId: organization.id, code: "ME", name: "Mechanical Engineering" }])));
  const password = "Student-management-tests-only!2026";
  async function signIn(email: string, currentPassword = password) {
    const response = await auth.api.signInEmail({ body: { email, password: currentPassword }, asResponse: true });
    return { status: response.status, cookie: response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ") };
  }
  async function person(name: string, role: "platform_admin" | "student" | "organization_viewer", organizationId: string | null) {
    const identity = await auth.api.createUser({ body: { name, email: `${name}@example.test`, password, role: role === "platform_admin" ? "admin" : "user" } });
    const [member] = await scoped(connection.db, { platform: true }, tx => tx.insert(s.members).values({
      authUserId: identity.user.id, organizationId, role, studentId: role === "student" ? name : null,
      cohort: "2026", branchName: "Computer Science", branchCode: "CSE", phone: "+919876543210",
      passwordSetupComplete: true, phoneVerifiedAt: new Date(), features: ["jobs"],
    }).returning());
    return { ...member, name, email: identity.user.email, cookie: (await signIn(identity.user.email)).cookie };
  }
  const admin = await person("management-admin", "platform_admin", null);
  const viewer = await person("management-viewer", "organization_viewer", org.id);
  const student = await person("management-student", "student", org.id);
  const foreign = await person("management-foreign", "student", otherOrg.id);
  const archived = await person("management-archived", "student", archivedOrg.id);
  const fixture = await scoped(connection.db, { platform: true }, async tx => {
    const [course] = await tx.insert(s.courses).values({ title: "Preserved course", description: "Profile changes retain learning", track: "general", status: "published" }).returning();
    const lesson = { id: randomUUID(), title: "Completed lesson", body: "Course content" };
    const [version] = await tx.insert(s.versions).values({ courseId: course.id, number: 1, title: course.title, description: course.description, lessons: [lesson] }).returning();
    await tx.insert(s.grants).values({ organizationId: org.id, memberId: student.id, courseId: course.id, versionId: version.id });
    await tx.insert(s.progress).values({ organizationId: org.id, memberId: student.id, versionId: version.id, lessonId: lesson.id });
    await tx.insert(s.accessPolicies).values([
      { organizationId: org.id, scope: "organization", targetKey: "organization", policy: { features: ["courses", "jobs"], courseIds: [course.id], practiceModuleIds: [] }, courseVersions: { [course.id]: version.id } },
      { organizationId: org.id, scope: "branch", targetKey: "ME", branchName: "Mechanical Engineering", policy: inheritPolicy() },
      { organizationId: org.id, scope: "student", targetKey: student.id, policy: { ...inheritPolicy(), courseIds: [course.id] }, courseVersions: { [course.id]: version.id } },
    ]);
    const [challenge] = await tx.insert(s.phoneChallenges).values({ organizationId: org.id, memberId: student.id, phone: student.phone!, codeHash: "unused-test-code", expiresAt: new Date(Date.now() + 600_000) }).returning();
    return { course, version, lesson, challenge };
  });
  await connection.db.update(s.user).set({ emailVerified: true }).where(eq(s.user.id, student.authUserId));
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(path: string, method = "GET", body?: unknown, cookie = admin.cookie) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method, headers: { Origin: config.origins[0], "Content-Type": "application/json", Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  }
  const input = (suffix: string) => ({ organizationId: org.id, studentId: `MANUAL-${suffix}`, name: `Student ${suffix}`, email: `${suffix}@management.example.test`, phone: "9123456789", branchName: "Computer Science", branchCode: "CSE", cohort: "2027" });
  const row = (suffix: string) => { const { organizationId, ...fields } = input(suffix); return { ...fields, collegeName: org.name }; };
  const importRows = (rows: unknown[]) => request("platform/students/import", "POST", { organizationId: org.id, rows });
  const counts = async () => ({
    users: (await connection.db.select({ id: s.user.id }).from(s.user)).length,
    accounts: (await connection.db.select({ id: s.account.id }).from(s.account)).length,
    outbox: (await connection.db.select({ id: s.outbox.id }).from(s.outbox)).length,
    ...await scoped(connection.db, { platform: true }, async tx => ({
      members: (await tx.select({ id: s.members.id }).from(s.members)).length,
      registrations: (await tx.select({ id: registrationRequests.id }).from(registrationRequests)).length,
      audit: (await tx.select({ id: s.audit.id }).from(s.audit)).length,
    })),
  });
  const registration = async (id: string) => (await scoped(connection.db, { platform: true }, tx => tx.select().from(registrationRequests).where(eq(registrationRequests.id, id))))[0];
  async function welcome(id: string) {
    const record = await registration(id);
    const [mail] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, record.welcomeOutboxId!));
    assert.equal(record.status, "approved");
    assert.equal(record.reviewedBy, admin.id);
    assert.equal(mail.type, "welcome_student");
    assert.equal(mail.status, "pending");
    const payload = decryptPayload(config.secret, mail.encryptedPayload, "welcome_student");
    assert.ok(payload.temporaryPassword.length >= 32);
    assert.ok(!mail.encryptedPayload.includes(payload.temporaryPassword));
    assert.equal(payload.loginUrl, `${config.origins[0]}/login`);
    return { record, payload, mail };
  }
  const history = () => scoped(connection.db, { platform: true }, async tx => ({
    grants: await tx.select().from(s.grants).orderBy(s.grants.id),
    progress: await tx.select().from(s.progress).orderBy(s.progress.id),
    policies: await tx.select().from(s.accessPolicies).orderBy(s.accessPolicies.id),
  }));
  const beforeHistory = await history();
  const editPath = `platform/organizations/${org.id}/students/${student.id}`;
  const profile = { name: student.name, email: student.email, phone: student.phone!, branchName: student.branchName!, branchCode: student.branchCode! };
  let publicPending = "", legacyPending = "";
  try {
    await t.test("public and older imported requests remain pending when Platform Admin provisions other students", async () => {
      const before = await counts();
      const publicResponse = await request("registration/requests", "POST", input("public-pending"), "");
      const legacy = await request("platform/registrations/import", "POST", { organizationId: org.id, rows: [row("legacy-pending")] });
      assert.equal(publicResponse.status, 201);
      assert.equal(publicResponse.body.status, "pending");
      assert.equal(legacy.body.results[0].status, "pending");
      publicPending = publicResponse.body.id;
      legacyPending = legacy.body.results[0].id;
      const after = await counts();
      assert.equal(after.users, before.users);
      assert.equal(after.members, before.members);
      assert.equal(after.outbox, before.outbox);
    });

    await t.test("new creation endpoints require Platform Admin and reject invalid identity or privilege fields", async () => {
      for (const [path, body] of [["platform/students", input("unauthorized")], ["platform/students/import", { organizationId: org.id, rows: [row("unauthorized")] }]] as const) {
        assert.equal((await request(path, "POST", body, "")).status, 401);
        for (const actor of [viewer, student]) assert.equal((await request(path, "POST", body, actor.cookie)).status, 403);
      }
      for (const extra of [{ role: "platform_admin" }, { password: "Injected-password!2026" }, { features: ["compiler"] }])
        assert.equal((await request("platform/students", "POST", { ...input("invalid"), ...extra })).status, 400);
      assert.equal((await importRows(Array(26).fill(row("limit")))).status, 400);
      assert.equal((await importRows([])).status, 400);
      assert.equal((await request("platform/students", "POST", { ...input("archived"), organizationId: archivedOrg.id })).status, 400);
    });

    await t.test("single creation immediately queues one welcome, never returns its password, and allows only student onboarding", async () => {
      const before = await counts();
      const created = await request("platform/students", "POST", input("single"));
      assert.equal(created.status, 201);
      assert.equal(created.body.status, "approved");
      assert.equal(created.body.emailStatus, "pending");
      assert.deepEqual(Object.keys(created.body).sort(), ["emailStatus", "id", "memberId", "status"]);
      assert.equal(created.headers.getSetCookie().length, 0);
      const { record, payload } = await welcome(created.body.id);
      assert.equal(record.memberId, created.body.memberId);
      assert.equal(payload.email, input("single").email);
      assert.ok(!JSON.stringify(created.body).includes(payload.temporaryPassword));
      const loggedIn = await signIn(payload.email, payload.temporaryPassword);
      assert.equal(loggedIn.status, 200);
      const me = await request("me?portal=student", "GET", undefined, loggedIn.cookie);
      assert.equal(me.status, 200);
      assert.equal(me.body.role, "student");
      assert.equal(me.body.onboardingStep, "password");
      assert.equal((await request("student/courses", "GET", undefined, loggedIn.cookie)).status, 403);
      const after = await counts();
      assert.equal(after.users, before.users + 1);
      assert.equal(after.members, before.members + 1);
      assert.equal(after.outbox, before.outbox + 1);
      assert.equal((await request("platform/students", "POST", input("single"))).status, 409);
      assert.equal((await request("platform/registrations/approve", "POST", { ids: [created.body.id] })).body.results[0].status, "already_approved");
      assert.deepEqual(await counts(), after);
    });

    await t.test("bulk provisioning creates only valid new identities and leaves existing pending requests untouched", async () => {
      const before = await counts();
      const imported = await importRows([
        row("bulk-one"), row("bulk-two"), row("bulk-one"),
        { ...row("existing-viewer"), email: viewer.email }, row("public-pending"), row("legacy-pending"),
        { ...row("invalid-college"), collegeName: "Wrong college" }, { ...row("invalid-role"), role: "platform_admin" },
      ]);
      assert.equal(imported.status, 201);
      assert.equal(imported.body.created, 2);
      assert.deepEqual(imported.body.results.map((result: { status: string }) => result.status), ["approved", "approved", "duplicate", "duplicate", "duplicate", "duplicate", "invalid", "invalid"]);
      for (const result of imported.body.results.slice(0, 2)) {
        const { record, payload } = await welcome(result.id);
        assert.equal(record.memberId, result.memberId);
        assert.ok(!JSON.stringify(imported.body).includes(payload.temporaryPassword));
        assert.equal((await signIn(payload.email, payload.temporaryPassword)).status, 200);
      }
      const after = await counts();
      assert.equal(after.users, before.users + 2);
      assert.equal(after.members, before.members + 2);
      assert.equal(after.outbox, before.outbox + 2);
      for (const id of [publicPending, legacyPending]) {
        const record = await registration(id);
        assert.equal(record.status, "pending");
        assert.equal(record.memberId, null);
        assert.equal(record.welcomeOutboxId, null);
      }
      assert.equal((await request("me?portal=organization", "GET", undefined, viewer.cookie)).body.role, "organization_viewer");
    });

    await t.test("failed mail staging rolls back direct and bulk account creation and permits a clean retry", async () => {
      const before = await counts();
      await connection.db.execute(sql.raw("CREATE FUNCTION management_mail_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='welcome_student' THEN RAISE EXCEPTION 'simulated welcome failure'; END IF; RETURN NEW; END $$;"));
      await connection.db.execute(sql.raw("CREATE TRIGGER management_mail_failure BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION management_mail_failure();"));
      try {
        assert.equal((await request("platform/students", "POST", input("rollback-single"))).status, 500);
        const bulk = await importRows([row("rollback-bulk")]);
        assert.equal(bulk.status, 201);
        assert.equal(bulk.body.created, 0);
        assert.equal(bulk.body.results[0].status, "failed");
        assert.deepEqual(await counts(), before);
      } finally {
        await connection.db.execute(sql.raw("DROP TRIGGER management_mail_failure ON outbox;"));
        await connection.db.execute(sql.raw("DROP FUNCTION management_mail_failure();"));
      }
      assert.equal((await request("platform/students", "POST", input("rollback-single"))).status, 201);
      assert.equal((await importRows([row("rollback-bulk")])).body.results[0].status, "approved");
      assert.equal((await counts()).outbox, before.outbox + 2);
    });

    await t.test("email corrections before onboarding replace obsolete welcome passwords and reject in-flight delivery", async () => {
      const created = await request("platform/students", "POST", input("readdress"));
      assert.equal(created.status, 201);
      const path = `platform/organizations/${org.id}/students/${created.body.memberId}`;
      let current = await welcome(created.body.id);
      let signedIn = await signIn(current.payload.email, current.payload.temporaryPassword);
      const fields = { name: "Corrected invitee", phone: input("readdress").phone, branchName: "Computer Science", branchCode: "CSE" };
      await connection.db.update(s.outbox).set({ status: "processing" }).where(eq(s.outbox.id, current.mail.id));
      const before = await counts();
      assert.equal((await request(path, "PATCH", { ...fields, email: "processing-blocked@example.test" })).status, 409);
      assert.deepEqual(await counts(), before);
      const unchanged = await request("me?portal=student", "GET", undefined, signedIn.cookie);
      assert.equal(unchanged.status, 200);
      assert.equal(unchanged.body.email, current.payload.email);

      for (const status of ["pending", "failed", "accepted"] as const) {
        await connection.db.update(s.outbox).set({ status, ...(status === "accepted" ? { encryptedPayload: "" } : {}) }).where(eq(s.outbox.id, current.mail.id));
        const email = `readdress-${status}@example.test`;
        const beforeMail = (await counts()).outbox;
        assert.equal((await request(path, "PATCH", { ...fields, email })).status, 200);
        const next = await welcome(created.body.id);
        assert.notEqual(next.mail.id, current.mail.id);
        assert.equal(next.payload.email, email);
        assert.equal(next.payload.name, fields.name);
        assert.notEqual(next.payload.temporaryPassword, current.payload.temporaryPassword);
        assert.equal((await counts()).outbox, beforeMail + 1);
        const [oldMail] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, current.mail.id));
        assert.equal(oldMail.status, status === "accepted" ? "accepted" : "expired");
        assert.equal(oldMail.encryptedPayload, "");
        assert.equal((await signIn(email, current.payload.temporaryPassword)).status, 401);
        assert.equal((await request("me?portal=student", "GET", undefined, signedIn.cookie)).status, 401);
        assert.equal((await request("onboarding/password", "POST", {
          currentPassword: next.payload.temporaryPassword, newPassword: "Revoked-session-must-not-change!2026",
        }, signedIn.cookie)).status, 401);
        signedIn = await signIn(email, next.payload.temporaryPassword);
        assert.equal(signedIn.status, 200);
        assert.equal((await request("me?portal=student", "GET", undefined, signedIn.cookie)).body.onboardingStep, "password");
        current = next;
      }
      await scoped(connection.db, { platform: true }, tx => tx.update(s.members).set({ passwordSetupComplete: true, phoneVerifiedAt: new Date() }).where(eq(s.members.id, created.body.memberId)));
      const beforeMail = (await counts()).outbox;
      const completedEmail = "readdress-complete@example.test";
      assert.equal((await request(path, "PATCH", { ...fields, email: completedEmail })).status, 200);
      assert.equal((await counts()).outbox, beforeMail);
      const [obsolete] = await connection.db.select().from(s.outbox).where(eq(s.outbox.id, current.mail.id));
      assert.equal(obsolete.status, "expired");
      assert.equal(obsolete.encryptedPayload, "");
      assert.equal((await signIn(completedEmail, current.payload.temporaryPassword)).status, 200);
    });

    await t.test("profile edits enforce organization scope, student role, immutable fields and unique identities", async () => {
      assert.equal((await request(editPath, "PATCH", profile, "")).status, 401);
      for (const actor of [viewer, student]) assert.equal((await request(editPath, "PATCH", profile, actor.cookie)).status, 403);
      for (const member of [viewer, foreign]) assert.equal((await request(`platform/organizations/${org.id}/students/${member.id}`, "PATCH", profile)).status, 404);
      assert.equal((await request(`platform/organizations/${otherOrg.id}/students/${student.id}`, "PATCH", profile)).status, 404);
      assert.equal((await request(`platform/organizations/${archivedOrg.id}/students/${archived.id}`, "PATCH", profile)).status, 400);
      for (const extra of [{ studentId: "Changed ID" }, { organizationId: otherOrg.id }, { role: "organization_viewer" }, { features: ["compiler"] }, { phoneVerifiedAt: new Date().toISOString() }, { cohort: "Changed cohort" }])
        assert.equal((await request(editPath, "PATCH", { ...profile, ...extra })).status, 400);
      assert.equal((await request(editPath, "PATCH", { ...profile, phone: "123" })).status, 400);
      assert.equal((await request(editPath, "PATCH", { ...profile, branchCode: "ME", branchName: "Wrong department" })).status, 400);
      for (const email of [viewer.email, input("public-pending").email, input("legacy-pending").email])
        assert.equal((await request(editPath, "PATCH", { ...profile, email })).status, 409);
      assert.deepEqual(await history(), beforeHistory);
      assert.equal((await request("me?portal=student", "GET", undefined, student.cookie)).status, 200);
    });

    await t.test("editing login email and phone revokes old sessions and verification without replacing learning records", async () => {
      await auth.api.requestPasswordReset({ body: { email: student.email, redirectTo: `${config.origins[0]}/reset-password` } });
      const resets = await connection.db.select().from(s.verification).where(eq(s.verification.value, student.authUserId));
      const reset = resets.find(record => record.identifier.startsWith("reset-password:"));
      assert.ok(reset);
      const changed = { name: "Corrected Student", email: "CORRECTED-STUDENT@example.test", phone: "9123456780", branchName: "Mechanical Engineering", branchCode: "me" };
      const response = await request(editPath, "PATCH", changed);
      assert.equal(response.status, 200);
      assert.equal(response.body.id, student.id);
      assert.equal(response.body.organizationId, org.id);
      assert.equal(response.body.name, changed.name);
      assert.equal(response.body.email, changed.email.toLowerCase());
      assert.equal(response.body.phone, "+919123456780");
      assert.equal(response.body.branchCode, "ME");
      assert.equal(response.body.studentId, student.studentId);
      assert.equal(response.body.cohort, student.cohort);
      assert.deepEqual(response.body.features, student.features);
      const [member] = await scoped(connection.db, { platform: true }, tx => tx.select().from(s.members).where(eq(s.members.id, student.id)));
      assert.equal(member.authUserId, student.authUserId);
      assert.equal(member.phoneVerifiedAt, null);
      assert.equal(member.passwordSetupComplete, true);
      const [identity] = await connection.db.select().from(s.user).where(eq(s.user.id, student.authUserId));
      assert.equal(identity.emailVerified, false);
      assert.deepEqual(await connection.db.select().from(s.verification).where(eq(s.verification.id, reset.id)), []);
      assert.equal((await auth.api.resetPassword({ body: { token: reset.identifier.slice("reset-password:".length), newPassword: "Old-link-must-not-work!2026" }, asResponse: true })).status, 400);
      const [challenge] = await scoped(connection.db, { platform: true }, tx => tx.select().from(s.phoneChallenges).where(eq(s.phoneChallenges.id, fixture.challenge.id)));
      assert.ok(challenge.consumedAt);
      assert.equal((await request("me?portal=student", "GET", undefined, student.cookie)).status, 401);
      assert.equal((await signIn(student.email)).status, 401);
      const fresh = await signIn(changed.email.toLowerCase());
      assert.equal(fresh.status, 200);
      const me = await request("me?portal=student", "GET", undefined, fresh.cookie);
      assert.equal(me.status, 200);
      assert.equal(me.body.id, student.id);
      assert.equal(me.body.onboardingStep, "phone");
      assert.equal((await request("student/courses", "GET", undefined, fresh.cookie)).status, 403);
      assert.equal((await request("me?portal=student", "GET", undefined, foreign.cookie)).status, 200);
      assert.equal((await request("me?portal=platform", "GET", undefined, admin.cookie)).status, 200);
      assert.deepEqual(await history(), beforeHistory);
      await scoped(connection.db, { platform: true }, tx => tx.update(s.members).set({ phoneVerifiedAt: new Date() }).where(eq(s.members.id, student.id)));
      const course = await request(`student/courses/${fixture.course.id}`, "GET", undefined, fresh.cookie);
      assert.equal(course.status, 200);
      assert.equal(course.body.versionId, fixture.version.id);
      assert.deepEqual(course.body.completedLessonIds, [fixture.lesson.id]);
    });

    await t.test("password onboarding rolls back credentials and sessions if its member update fails", async () => {
      const learner = await person("management-atomic-password", "student", org.id);
      await scoped(connection.db, { platform: true }, tx => tx.update(s.members).set({ passwordSetupComplete: false }).where(eq(s.members.id, learner.id)));
      const accountBefore = await connection.db.select().from(s.account).where(eq(s.account.userId, learner.authUserId));
      const sessionsBefore = await connection.db.select({ id: s.session.id }).from(s.session).where(eq(s.session.userId, learner.authUserId));
      const changedPassword = "Atomic-password-change!2026";
      await connection.db.execute(sql.raw("CREATE FUNCTION management_setup_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated member setup failure'; END $$;"));
      await connection.db.execute(sql.raw("CREATE TRIGGER management_setup_failure BEFORE UPDATE OF password_setup_complete ON members FOR EACH ROW WHEN (NEW.password_setup_complete AND NOT OLD.password_setup_complete) EXECUTE FUNCTION management_setup_failure();"));
      try {
        assert.equal((await request("onboarding/password", "POST", { currentPassword: password, newPassword: changedPassword }, learner.cookie)).status, 500);
        assert.deepEqual(await connection.db.select().from(s.account).where(eq(s.account.userId, learner.authUserId)), accountBefore);
        assert.deepEqual(await connection.db.select({ id: s.session.id }).from(s.session).where(eq(s.session.userId, learner.authUserId)), sessionsBefore);
        assert.equal((await request("me?portal=student", "GET", undefined, learner.cookie)).body.onboardingStep, "password");
        assert.equal((await signIn(learner.email, changedPassword)).status, 401);
        assert.equal((await signIn(learner.email)).status, 200);
      } finally {
        await connection.db.execute(sql.raw("DROP TRIGGER management_setup_failure ON members;"));
        await connection.db.execute(sql.raw("DROP FUNCTION management_setup_failure();"));
      }
      assert.equal((await request("onboarding/password", "POST", { currentPassword: password, newPassword: changedPassword }, learner.cookie)).status, 201);
      assert.equal((await signIn(learner.email)).status, 401);
      const fresh = await signIn(learner.email, changedPassword);
      assert.equal(fresh.status, 200);
      assert.equal((await request("me?portal=student", "GET", undefined, fresh.cookie)).body.onboardingStep, null);
    });

    await t.test("legacy students without a registration ledger receive only their latest corrected welcome", async () => {
      // Keep unrelated fixture mail outside this isolated worker dispatch window.
      await connection.db.update(s.outbox).set({ availableAt: new Date(Date.now() + 86400_000) });
      const existingIds = new Set((await connection.db.select({ id: s.outbox.id }).from(s.outbox)).map(mail => mail.id));
      const learner = await person("management-legacy-invite", "student", org.id);
      await scoped(connection.db, { platform: true }, tx => tx.update(s.members).set({ passwordSetupComplete: false }).where(eq(s.members.id, learner.id)));
      const path = `platform/organizations/${org.id}/students/${learner.id}`;
      const edit = (email: string) => request(path, "PATCH", { name: learner.name, email, phone: learner.phone, branchName: learner.branchName, branchCode: learner.branchCode });
      assert.equal((await edit("legacy-first@example.test")).status, 200);
      const [first] = (await connection.db.select().from(s.outbox)).filter(mail => !existingIds.has(mail.id));
      const firstPayload = decryptPayload(config.secret, first.encryptedPayload, "welcome_student");
      assert.equal(firstPayload.userId, learner.authUserId);
      assert.equal((await edit("legacy-second@example.test")).status, 200);
      const [second] = (await connection.db.select().from(s.outbox)).filter(mail => !existingIds.has(mail.id) && mail.id !== first.id);
      const secondPayload = decryptPayload(config.secret, second.encryptedPayload, "welcome_student");
      assert.notEqual(secondPayload.temporaryPassword, firstPayload.temporaryPassword);
      assert.equal((await signIn(secondPayload.email, firstPayload.temporaryPassword)).status, 401);
      assert.equal((await signIn(secondPayload.email, secondPayload.temporaryPassword)).status, 200);
      assert.deepEqual(await scoped(connection.db, { platform: true }, tx => tx.select().from(registrationRequests).where(eq(registrationRequests.memberId, learner.id))), []);
      const delivered: string[] = [];
      const sender = {
        async password_reset() { assert.fail("No unrelated reset should be dispatched."); },
        async welcome_student(_id: string, payload: { email: string }) { delivered.push(payload.email); },
      };
      await deliverOne(connection.db, config.secret, sender);
      await deliverOne(connection.db, config.secret, sender);
      assert.deepEqual(delivered, [secondPayload.email]);
      const mails = await connection.db.select().from(s.outbox);
      assert.equal(mails.find(mail => mail.id === first.id)!.status, "expired");
      assert.equal(mails.find(mail => mail.id === second.id)!.status, "accepted");
      assert.equal(mails.find(mail => mail.id === first.id)!.encryptedPayload, "");
    });
  } finally {
    await app.close();
    await connection.close();
    if (previousPortal === undefined) delete process.env.STUDENT_PORTAL_URL;
    else process.env.STUDENT_PORTAL_URL = previousPortal;
  }
});
