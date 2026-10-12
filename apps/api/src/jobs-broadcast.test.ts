import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import * as s from "./schema.js";

test("job broadcasts publish atomically to active organizations and retain tenant access boundaries", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "jobs-broadcast-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5174"], port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(connection.db, auth, config, {
    configured: false, async send() { assert.fail("Job tests must not send external messages."); },
  }, true);
  const [first, second, archived] = await scoped(connection.db, { platform: true }, tx =>
    tx.insert(s.organizations).values([
      { name: "First College" }, { name: "Second College" },
      { name: "Archived College", status: "archived" },
    ]).returning());

  async function person(name: string, role: "platform_admin" | "student" | "organization_viewer", organizationId: string | null, features = ["jobs"]) {
    const password = "Jobs-broadcast-tests-only!2026";
    const identity = await auth.api.createUser({ body: {
      name, email: `${name}@example.test`, password, role: role === "platform_admin" ? "admin" : "user",
    } });
    const [member] = await scoped(connection.db, { platform: true }, tx => tx.insert(s.members).values({
      authUserId: identity.user.id, organizationId, role, features,
      passwordSetupComplete: true, phoneVerifiedAt: new Date(),
    }).returning());
    const signedIn = await auth.api.signInEmail({ body: { email: identity.user.email, password }, asResponse: true });
    assert.equal(signedIn.status, 200);
    return { ...member, cookie: signedIn.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ") };
  }
  const admin = await person("jobs-admin", "platform_admin", null);
  const viewer = await person("jobs-viewer", "organization_viewer", first.id);
  const firstStudent = await person("jobs-first-student", "student", first.id);
  const secondStudent = await person("jobs-second-student", "student", second.id);
  const restricted = await person("jobs-disabled-student", "student", first.id, []);
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const fields = {
    title: "Graduate software engineer", company: "Example Company",
    description: "Apply for the graduate engineering opportunity.",
    url: "https://example.test/careers/graduate-engineer",
  };
  async function request(path: string, cookie = admin.cookie, method = "GET", body?: unknown) {
    const response = await fetch(`${base}/api/v1/${path}`, {
      method,
      headers: { Origin: config.origins[0], "Content-Type": "application/json", Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  }
  const snapshot = () => scoped(connection.db, { platform: true }, async tx => ({
    jobs: await tx.select().from(s.jobs).orderBy(s.jobs.id),
    audits: await tx.select().from(s.audit).where(eq(s.audit.action, "job.published")).orderBy(s.audit.id),
  }));
  try {
    await t.test("one publication reaches all active organizations and skips archived organizations", async () => {
      const published = await request("platform/jobs", admin.cookie, "POST", { audience: "all", ...fields });
      assert.equal(published.status, 201);
      assert.deepEqual(published.body, {
        publishedCount: 2, organizationIds: [first.id, second.id].sort(),
      });
      const firstJobs = await request("student/jobs", firstStudent.cookie);
      const secondJobs = await request("student/jobs", secondStudent.cookie);
      for (const [response, organizationId] of [[firstJobs, first.id], [secondJobs, second.id]] as const) {
        assert.equal(response.status, 200);
        assert.equal(response.body.length, 1);
        assert.deepEqual(response.body[0], {
          ...fields, organizationId, id: response.body[0].id, postedAt: response.body[0].postedAt,
        });
        assert.ok(response.body[0].id);
        assert.ok(Date.parse(response.body[0].postedAt));
      }
      assert.notEqual(firstJobs.body[0].id, secondJobs.body[0].id);
      const archivedJobs = await request(`platform/jobs?organizationId=${archived.id}`);
      assert.equal(archivedJobs.status, 200);
      assert.deepEqual(archivedJobs.body, []);
      const saved = await snapshot();
      assert.equal(saved.jobs.length, 2);
      assert.deepEqual(saved.audits.map(event => event.resourceId).sort(), saved.jobs.map(job => job.id).sort());
      assert.ok(saved.audits.every(event => event.actorId === admin.id));
    });

    await t.test("existing single-organization publishing stays compatible without cross-organization leakage", async () => {
      const published = await request("platform/jobs", admin.cookie, "POST", {
        organizationId: first.id, ...fields, title: "First College exclusive",
      });
      assert.equal(published.status, 201);
      assert.equal(published.body.title, "First College exclusive");
      assert.equal(published.body.organizationId, first.id);
      assert.ok(published.body.id);
      assert.equal(published.body.publishedCount, undefined);
      const firstJobs = await request(`student/jobs?organizationId=${second.id}`, firstStudent.cookie);
      const secondJobs = await request(`student/jobs?organizationId=${first.id}`, secondStudent.cookie);
      assert.equal(firstJobs.body.length, 2);
      assert.equal(secondJobs.body.length, 1);
      assert.ok(firstJobs.body.every((job: typeof s.jobs.$inferSelect) => job.organizationId === first.id));
      assert.ok(secondJobs.body.every((job: typeof s.jobs.$inferSelect) => job.organizationId === second.id));
      const scopedJobs = await scoped(connection.db, { organizationId: second.id, authId: secondStudent.authUserId }, tx =>
        tx.select().from(s.jobs));
      assert.equal(scopedJobs.length, 1);
      assert.ok(scopedJobs.every(job => job.organizationId === second.id));
    });

    await t.test("publishing does not bypass the student's jobs entitlement", async () => {
      const response = await request("student/jobs", restricted.cookie);
      assert.equal(response.status, 403);
      assert.match(response.body.message, /not assigned this feature/i);
    });

    await t.test("only platform admins can publish to one or all organizations", async () => {
      const before = await snapshot();
      for (const member of [firstStudent, viewer]) {
        for (const audience of [{ audience: "all" }, { organizationId: first.id }]) {
          const response = await request("platform/jobs", member.cookie, "POST", { ...audience, ...fields });
          assert.equal(response.status, 403);
        }
        assert.equal((await request(`platform/jobs?organizationId=${first.id}`, member.cookie)).status, 403);
      }
      assert.equal((await request("platform/jobs", "", "POST", { audience: "all", ...fields })).status, 401);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("ambiguous audiences and invalid fields are rejected without side effects", async () => {
      const before = await snapshot();
      for (const input of [
        { audience: "all", organizationId: first.id, ...fields },
        { audience: "all", organizationId: null, ...fields },
        { audience: "unknown", ...fields },
        fields,
        { audience: "all", ...fields, title: "   " },
        { audience: "all", ...fields, company: "x".repeat(151) },
        { audience: "all", ...fields, description: "x".repeat(3001) },
        { audience: "all", ...fields, url: "http://example.test/apply" },
        { audience: "all", ...fields, url: "https://user:password@example.test/apply" },
      ]) assert.equal((await request("platform/jobs", admin.cookie, "POST", input)).status, 400);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("single-organization posting rejects archived and missing organizations", async () => {
      const before = await snapshot();
      const inactive = await request("platform/jobs", admin.cookie, "POST", { organizationId: archived.id, ...fields });
      assert.equal(inactive.status, 400);
      assert.match(inactive.body.message, /activate the organization/i);
      assert.equal((await request("platform/jobs", admin.cookie, "POST", { organizationId: randomUUID(), ...fields })).status, 404);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("an audit failure rolls back every organization's job", async () => {
      const before = await snapshot();
      await connection.db.execute(sql`alter table audit_logs add constraint jobs_test_failure check (action <> 'job.published') not valid`);
      try {
        const response = await request("platform/jobs", admin.cookie, "POST", { audience: "all", ...fields, title: "Must roll back" });
        assert.equal(response.status, 500);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await connection.db.execute(sql`alter table audit_logs drop constraint jobs_test_failure`);
      }
    });

    await t.test("an empty active audience is a clear error instead of a successful no-op", async () => {
      await scoped(connection.db, { platform: true }, tx => tx.update(s.organizations).set({ status: "archived" }));
      const before = await snapshot();
      const response = await request("platform/jobs", admin.cookie, "POST", { audience: "all", ...fields });
      assert.equal(response.status, 400);
      assert.match(response.body.message, /create or activate an organization/i);
      assert.deepEqual(await snapshot(), before);
    });
  } finally {
    await app.close();
    await connection.close();
  }
});
