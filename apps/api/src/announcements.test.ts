import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { OrganizationAnnouncement } from "@slate/contracts";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import { inheritPolicy } from "./access.js";
import * as s from "./schema.js";

test("organization announcements enforce audience, lifecycle and tenant access through HTTP and RLS", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "announcements-test-only-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5174"],
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
        assert.fail("No external messages in announcement tests.");
      },
    },
    true,
  );
  const [org, other, demo] = await scoped(
    connection.db,
    { platform: true },
    (tx) =>
      tx
        .insert(s.organizations)
        .values([
          { name: "Announcement College" },
          { name: "Foreign College" },
          { name: "Northstar Institute of Technology · Demo" },
        ])
        .returning(),
  );
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.organizationBranches).values([{ organizationId: org.id, code: "CSE", name: "Computer Science" }, { organizationId: org.id, code: "ME", name: "Mechanical" }, { organizationId: org.id, code: "CIVIL", name: "Civil Engineering" }, { organizationId: other.id, code: "ECE", name: "ECE" }]));
  async function person(
    name: string,
    role: "platform_admin" | "student" | "organization_viewer",
    organizationId: string | null,
    branchCode: string | null = null,
    status = "active",
  ) {
    const result = await auth.api.createUser({
      body: {
        name,
        email: `${name}@example.test`,
        password: "Only-test!Password2026",
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: result.user.id,
          organizationId,
          role,
          status,
          branchCode,
          branchName:
            branchCode?.trim().toUpperCase() === "CSE"
              ? "Computer Science"
              : branchCode === "ME"
                ? "Mechanical"
                : branchCode,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
        })
        .returning(),
    );
    const response = await auth.api.signInEmail({
      body: { email: result.user.email, password: "Only-test!Password2026" },
      asResponse: true,
    });
    assert.equal(response.status, 200);
    return {
      ...member,
      cookie: response.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    };
  }
  const admin = await person("announcement-admin", "platform_admin", null);
  const cse = await person("announcement-cse", "student", org.id, " cse ");
  const me = await person("announcement-me", "student", org.id, "ME");
  const noBranch = await person("announcement-general", "student", org.id);
  const inactive = await person(
    "announcement-inactive",
    "student",
    org.id,
    "CSE",
    "suspended",
  );
  const viewer = await person(
    "announcement-viewer",
    "organization_viewer",
    org.id,
  );
  const foreign = await person(
    "announcement-foreign",
    "student",
    other.id,
    "ECE",
  );
  const demoStudent = await person(
    "announcement-demo",
    "student",
    demo.id,
    "CSE",
  );
  await scoped(connection.db, { platform: true }, (tx) =>
    tx.insert(s.accessPolicies).values({
      organizationId: org.id,
      scope: "branch",
      targetKey: "CIVIL",
      branchName: "Civil Engineering",
      policy: inheritPolicy(),
    }),
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
  const payload = (patch: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    organizationId: org.id,
    branchCode: null,
    title: "College notice",
    body: "Please review the **updated schedule**.",
    format: "markdown",
    ...patch,
  });
  let all: OrganizationAnnouncement, targeted: OrganizationAnnouncement;
  try {
    await t.test(
      "only a signed-in platform admin may manage notices or inspect audiences",
      async () => {
        assert.equal(
          (await request(`platform/announcements?organizationId=${org.id}`, ""))
            .status,
          401,
        );
        for (const cookie of [cse.cookie, viewer.cookie]) {
          assert.equal(
            (
              await request(
                `platform/announcements/audience?organizationId=${org.id}`,
                cookie,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                `platform/announcements?organizationId=${org.id}`,
                cookie,
              )
            ).status,
            403,
          );
          assert.equal(
            (await request("platform/announcements", cookie, "POST", payload()))
              .status,
            403,
          );
          assert.equal(
            (
              await request(
                `platform/announcements/${randomUUID()}`,
                cookie,
                "PATCH",
                { status: "archived" },
              )
            ).status,
            403,
          );
        }
      },
    );
    await t.test(
      "audience counts active students and includes empty policy branches",
      async () => {
        const audience = await request(
          `platform/announcements/audience?organizationId=${org.id}`,
        );
        assert.equal(audience.status, 200);
        assert.equal(audience.body.studentCount, 3);
        assert.deepEqual(
          audience.body.branches.map((branch: any) => [
            branch.code,
            branch.studentCount,
          ]),
          [
            ["CIVIL", 0],
            ["CSE", 1],
            ["ME", 1],
          ],
        );
        assert.equal(
          audience.body.branches.find((branch: any) => branch.code === "CSE")
            .name,
          "Computer Science",
        );
        assert.equal(
          (
            await request(
              `platform/announcements/audience?organizationId=${randomUUID()}`,
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      "published all-organization and normalized branch notices are idempotent",
      async () => {
        const body = payload();
        const first = await request(
          "platform/announcements",
          admin.cookie,
          "POST",
          body,
        );
        assert.equal(first.status, 201);
        all = first.body;
        assert.equal(all.organizationName, org.name);
        assert.equal(all.branchCode, null);
        const repeats = await Promise.all(
          Array.from({ length: 3 }, () =>
            request("platform/announcements", admin.cookie, "POST", body),
          ),
        );
        assert(
          repeats.every(
            (repeat) => repeat.status === 201 && repeat.body.id === all.id,
          ),
        );
        assert.equal(
          (
            await request("platform/announcements", admin.cookie, "POST", {
              ...body,
              title: "Changed",
            })
          ).status,
          409,
        );
        const branchNotice = await request(
          "platform/announcements",
          admin.cookie,
          "POST",
          payload({ branchCode: " cse ", title: "CSE notice" }),
        );
        assert.equal(branchNotice.status, 201);
        targeted = branchNotice.body;
        assert.equal(targeted.branchCode, "CSE");
        assert.equal(targeted.branchName, "Computer Science");
        const emptyBranch = await request(
          "platform/announcements",
          admin.cookie,
          "POST",
          payload({ branchCode: "CIVIL" }),
        );
        assert.equal(emptyBranch.status, 201);
        const audit = await scoped(connection.db, { platform: true }, (tx) =>
          tx.select().from(s.audit).where(eq(s.audit.resourceId, all.id)),
        );
        assert.equal(audit.length, 1);
        assert.equal(audit[0].action, "announcement.published");
      },
    );
    await t.test(
      "invalid fields and cross-organization branch selection are rejected",
      async () => {
        for (const change of [
          { title: " " },
          { title: "a".repeat(151) },
          { body: " " },
          { body: "a".repeat(10001) },
          { format: "html" },
          { branchCode: "bad code" },
          { branchCode: "" },
          { branchCode: "ECE" },
          { clientId: "bad" },
          { unknown: true },
        ])
          assert.equal(
            (
              await request(
                "platform/announcements",
                admin.cookie,
                "POST",
                payload(change),
              )
            ).status,
            400,
            JSON.stringify(change).slice(0, 100),
          );
        assert.equal(
          (
            await request(
              "platform/announcements",
              admin.cookie,
              "POST",
              payload({ organizationId: randomUUID() }),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `platform/announcements?organizationId=${org.id}&page=0`,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `platform/announcements/${all.id}`,
              admin.cookie,
              "PATCH",
              { status: "deleted" },
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "students only see own organization and current branch; notices carry no admin-only metadata",
      async () => {
        const cseFeed = await request("student/announcements", cse.cookie);
        assert.equal(cseFeed.status, 200);
        assert.deepEqual(
          new Set(cseFeed.body.map((notice: any) => notice.id)),
          new Set([all.id, targeted.id]),
        );
        assert(
          cseFeed.body.every(
            (notice: any) =>
              !notice.sample && !notice.clientId && !notice.createdBy,
          ),
        );
        for (const cookie of [me.cookie, noBranch.cookie])
          assert.deepEqual(
            (await request("student/announcements", cookie)).body.map(
              (notice: any) => notice.id,
            ),
            [all.id],
          );
        assert.deepEqual(
          (await request("student/announcements", foreign.cookie)).body,
          [],
        );
        assert.equal(
          (await request("student/announcements", viewer.cookie)).status,
          403,
        );
        assert.equal(
          (await request("student/announcements", inactive.cookie)).status,
          403,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ branchCode: "ME" })
            .where(eq(s.members.id, cse.id)),
        );
        assert.deepEqual(
          (await request("student/announcements", cse.cookie)).body.map(
            (notice: any) => notice.id,
          ),
          [all.id],
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.members)
            .set({ branchCode: "cse" })
            .where(eq(s.members.id, cse.id)),
        );
      },
    );
    await t.test(
      "archive hides a notice, restore reuses it, archived organizations reject publishing and restoring",
      async () => {
        assert.equal(
          (
            await request(
              `platform/announcements/${targeted.id}`,
              admin.cookie,
              "PATCH",
              { status: "archived" },
            )
          ).status,
          200,
        );
        assert.deepEqual(
          (await request("student/announcements", cse.cookie)).body.map(
            (notice: any) => notice.id,
          ),
          [all.id],
        );
        const archived = await request(
          `platform/announcements?organizationId=${org.id}&status=archived`,
        );
        assert.equal(archived.body.total, 1);
        assert.equal(archived.body.items[0].id, targeted.id);
        assert.equal(
          (
            await request(
              `platform/announcements/${targeted.id}`,
              admin.cookie,
              "PATCH",
              { status: "published" },
            )
          ).body.id,
          targeted.id,
        );
        assert.equal(
          (await request("student/announcements", cse.cookie)).body.length,
          2,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizations)
            .set({ status: "archived" })
            .where(eq(s.organizations.id, org.id)),
        );
        assert.equal(
          (
            await request(
              "platform/announcements",
              admin.cookie,
              "POST",
              payload(),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `platform/announcements/${all.id}`,
              admin.cookie,
              "PATCH",
              { status: "archived" },
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              `platform/announcements/${all.id}`,
              admin.cookie,
              "PATCH",
              { status: "published" },
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("student/announcements", cse.cookie)).status,
          403,
        );
        assert.equal(
          (
            await request(
              `platform/announcements/audience?organizationId=${org.id}`,
            )
          ).body.status,
          "archived",
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .update(s.organizations)
            .set({ status: "active" })
            .where(eq(s.organizations.id, org.id)),
        );
        await request(
          `platform/announcements/${all.id}`,
          admin.cookie,
          "PATCH",
          { status: "published" },
        );
      },
    );
    await t.test(
      "announcement feature removal takes effect on the next request",
      async () => {
        const [policy] = await scoped(connection.db, { platform: true }, (tx) =>
          tx
            .insert(s.accessPolicies)
            .values({
              organizationId: org.id,
              scope: "student",
              targetKey: cse.id,
              policy: { ...inheritPolicy(), features: [] },
            })
            .returning(),
        );
        assert.equal(
          (await request("student/announcements", cse.cookie)).status,
          403,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx.delete(s.accessPolicies).where(eq(s.accessPolicies.id, policy.id)),
        );
        assert.equal(
          (await request("student/announcements", cse.cookie)).status,
          200,
        );
      },
    );
    await t.test(
      "database RLS prevents foreign/other-branch reads and all student/viewer writes",
      async () => {
        for (const member of [me, foreign, viewer, inactive]) {
          const rows = await scoped(
            connection.db,
            {
              authId: member.authUserId,
              organizationId: member.organizationId,
            },
            (tx) => tx.select().from(s.announcements),
          );
          assert.deepEqual(
            rows.map((row) => row.id),
            member.id === me.id ? [all.id] : [],
          );
          await assert.rejects(
            scoped(
              connection.db,
              {
                authId: member.authUserId,
                organizationId: member.organizationId,
              },
              (tx) =>
                tx
                  .insert(s.announcements)
                  .values({
                    clientId: randomUUID(),
                    organizationId: org.id,
                    title: "Unauthorized",
                    body: "Blocked",
                    format: "plain",
                    createdBy: member.id,
                    authorName: "Imposter",
                  }),
            ),
          );
          const updated = await scoped(
            connection.db,
            {
              authId: member.authUserId,
              organizationId: member.organizationId,
            },
            (tx) =>
              tx
                .update(s.announcements)
                .set({ body: "Changed" })
                .where(eq(s.announcements.id, all.id))
                .returning(),
          );
          assert.equal(updated.length, 0);
        }
        const policies = await connection.db.execute(
          sql`select relrowsecurity, relforcerowsecurity from pg_class where relname='announcements'`,
        );
        assert.equal(policies.rows[0].relrowsecurity, true);
        assert.equal(policies.rows[0].relforcerowsecurity, true);
      },
    );
    await t.test(
      "demo students retain clearly identified sample notices alongside real notices",
      async () => {
        const created = await request(
          "platform/announcements",
          admin.cookie,
          "POST",
          payload({ organizationId: demo.id }),
        );
        assert.equal(created.status, 201);
        const notices = (
          await request("student/announcements", demoStudent.cookie)
        ).body;
        assert.equal(notices[0].id, created.body.id);
        assert(notices.slice(1).length > 0);
        assert(notices.slice(1).every((item: any) => item.sample === true));
        assert(
          (await request("student/announcements", cse.cookie)).body.every(
            (item: any) => item.sample !== true,
          ),
        );
      },
    );
    await t.test("admin paging and the student feed stay bounded", async () => {
      await scoped(connection.db, { platform: true }, (tx) =>
        tx
          .insert(s.announcements)
          .values(
            Array.from({ length: 105 }, (_, index) => ({
              clientId: randomUUID(),
              organizationId: other.id,
              title: `Notice ${index}`,
              body: "Test notice",
              format: "plain" as const,
              createdBy: admin.id,
              authorName: "Admin",
            })),
          ),
      );
      const page = (
        await request(
          `platform/announcements?organizationId=${other.id}&page=2`,
        )
      ).body;
      assert.equal(page.total, 105);
      assert.equal(page.page, 2);
      assert.equal(page.pageSize, 20);
      assert.equal(page.items.length, 20);
      const last = (
        await request(
          `platform/announcements?organizationId=${other.id}&page=999`,
        )
      ).body;
      assert.equal(last.page, 6);
      assert.equal(last.items.length, 5);
      assert.equal(
        (await request("student/announcements", foreign.cookie)).body.length,
        100,
      );
    });
  } finally {
    await app.close();
    await connection.close();
  }
});
