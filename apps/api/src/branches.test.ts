import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { inheritPolicy } from "./access.js";
import { SlateService } from "./service.js";
import { registrationRequests } from "./registration.js";
import * as s from "./schema.js";

test("branch catalog governs creation, registration, imports and audience selection through HTTP and RLS", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "branch-catalog-tests-only-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const previousPortal = process.env.STUDENT_PORTAL_URL;
  process.env.STUDENT_PORTAL_URL = config.origins[0];
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(
    connection.db,
    auth,
    config,
    true,
  );
  const [org, other, archived] = await scoped(
    connection.db,
    { platform: true },
    (tx) =>
      tx
        .insert(s.organizations)
        .values([
          { name: "Branch College" },
          { name: "Another College" },
          { name: "Archived College", status: "archived" },
        ])
        .returning(),
  );
  async function person(
    name: string,
    role: "platform_admin" | "organization_viewer",
  ) {
    const identity = await auth.api.createUser({
      body: {
        name,
        email: `${name}@example.test`,
        password: "Branch-tests-password!2026",
        role: role === "platform_admin" ? "admin" : "user",
      },
    });
    const [member] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(s.members)
        .values({
          authUserId: identity.user.id,
          role,
          organizationId: role === "platform_admin" ? null : org.id,
          passwordSetupComplete: true,
        })
        .returning(),
    );
    const response = await auth.api.signInEmail({
      body: {
        email: identity.user.email,
        password: "Branch-tests-password!2026",
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
  const admin = await person("branch-admin", "platform_admin"),
    viewer = await person("branch-viewer", "organization_viewer");
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  t.after(async () => {
    await app.close();
    await connection.close();
    if (previousPortal === undefined) delete process.env.STUDENT_PORTAL_URL;
    else process.env.STUDENT_PORTAL_URL = previousPortal;
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
  const path = `platform/organizations/${org.id}/branches`;
  const student = (suffix: string, patch: Record<string, unknown> = {}) => ({
    organizationId: org.id,
    studentId: `BRANCH-${suffix}`,
    name: `Student ${suffix}`,
    email: `${suffix}@branches.example.test`,
    phone: "9876543210",
    branchCode: "CSE",
    branchName: "Computer Science",
    ...patch,
  });
  const counts = () =>
    scoped(connection.db, { platform: true }, async (tx) => ({
      members: (await tx.select().from(s.members)).length,
      requests: (await tx.select().from(registrationRequests)).length,
      mail: (await tx.select().from(s.outbox)).length,
    }));
  await t.test(
    "only platform admins create; names/codes normalize and duplicates are scoped to organization",
    async () => {
      assert.equal(
        (
          await request(
            path,
            "POST",
            { code: "CSE", name: "Computer Science" },
            "",
          )
        ).status,
        401,
      );
      assert.equal(
        (
          await request(
            path,
            "POST",
            { code: "CSE", name: "Computer Science" },
            viewer.cookie,
          )
        ).status,
        403,
      );
      assert.equal(
        (await request(path, "GET", undefined, viewer.cookie)).status,
        403,
      );
      const created = await request(path, "POST", {
        code: " cse ",
        name: " Computer  Science ",
      });
      assert.equal(created.status, 201);
      assert.deepEqual(created.body, {
        organizationId: org.id,
        code: "CSE",
        name: "Computer Science",
      });
      for (const input of [
        { code: "cSe", name: "Another name" },
        { code: "CS", name: "computer science" },
      ])
        assert.equal((await request(path, "POST", input)).status, 409);
      assert.equal(
        (
          await request(`platform/organizations/${other.id}/branches`, "POST", {
            code: "ECE",
            name: "Electronics",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(`platform/organizations/${other.id}/branches`, "POST", {
            code: "CSE",
            name: "Computer Science",
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request(
            `platform/organizations/${archived.id}/branches`,
            "POST",
            { code: "CSE", name: "Computer Science" },
          )
        ).status,
        400,
      );
      assert.equal(
        (await request(path, "POST", { code: "<bad>", name: "Invalid" }))
          .status,
        400,
      );
      assert.equal(
        (
          await request(path, "POST", {
            code: "ME",
            name: "Mechanical",
            role: "student",
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    "public catalog returns only chosen active organization's canonical fields; tenant RLS cannot write",
    async () => {
      const catalog = await request(
        `registration/organizations/${org.id}/branches`,
        "GET",
        undefined,
        "",
      );
      assert.deepEqual(catalog.body, [
        { organizationId: org.id, code: "CSE", name: "Computer Science" },
      ]);
      assert.equal(
        (
          await request(
            `registration/organizations/${archived.id}/branches`,
            "GET",
            undefined,
            "",
          )
        ).status,
        400,
      );
      const rows = await scoped(
        connection.db,
        { organizationId: org.id, authId: viewer.authUserId, readonly: true },
        (tx) => tx.select().from(s.organizationBranches),
      );
      assert.equal(rows.length, 1);
      await assert.rejects(
        scoped(
          connection.db,
          { organizationId: org.id, authId: viewer.authUserId },
          (tx) =>
            tx
              .insert(s.organizationBranches)
              .values({
                organizationId: org.id,
                code: "HACK",
                name: "Unapproved branch",
              }),
        ),
      );
      const publicRows = await connection.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE slate_registration`);
        await tx.execute(
          sql`select set_config('slate.org_id', ${org.id}, true), set_config('slate.is_platform', 'false', true)`,
        );
        return tx.select().from(s.organizationBranches);
      });
      assert.equal(publicRows.length, 1);
    },
  );
  await t.test(
    "unknown, foreign and misspelled branches never create accounts or enqueue welcome emails",
    async () => {
      const before = await counts();
      for (const patch of [
        { branchCode: "UNKNOWN" },
        { branchCode: "ECE", branchName: "Electronics" },
        { branchName: "Computer Scienec" },
      ]) {
        assert.equal(
          (
            await request(
              "platform/students",
              "POST",
              student("invalid", patch),
            )
          ).status,
          400,
        );
        const { organizationId, ...row } = student("invalid-import", patch);
        const imported = await request("platform/students/import", "POST", {
          organizationId,
          rows: [row],
        });
        assert.equal(imported.status, 201);
        assert.equal(imported.body.results[0].status, "invalid");
        const staged = await request("platform/registrations/import", "POST", {
          organizationId,
          rows: [row],
        });
        assert.equal(staged.body.results[0].status, "invalid");
      }
      assert.equal(
        (
          await request(
            "registration/requests",
            "POST",
            student("public-bad", {
              branchCode: "ECE",
              branchName: "Electronics",
            }),
            "",
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            "registration/requests",
            "POST",
            student("public-misspelled", { branchName: "Computer Scienec" }),
            "",
          )
        ).status,
        400,
      );
      assert.deepEqual(await counts(), before);
    },
  );
  let memberId: string;
  await t.test(
    "case variants save canonical names, public signup stays pending and admin creation is approved",
    async () => {
      const pending = await request(
        "registration/requests",
        "POST",
        student("public", {
          branchCode: " cse ",
          branchName: "computer   science",
        }),
        "",
      );
      assert.equal(pending.status, 201);
      assert.equal(pending.body.status, "pending");
      const [saved] = await scoped(connection.db, { platform: true }, (tx) =>
        tx
          .select()
          .from(registrationRequests)
          .where(eq(registrationRequests.id, pending.body.id)),
      );
      assert.equal(saved.branchName, "Computer Science");
      assert.equal(saved.branchCode, "CSE");
      const created = await request(
        "platform/students",
        "POST",
        student("manual", {
          branchCode: "cse",
          branchName: "COMPUTER SCIENCE",
        }),
      );
      assert.equal(created.status, 201);
      assert.equal(created.body.status, "approved");
      memberId = created.body.memberId;
      const [member] = await scoped(connection.db, { platform: true }, (tx) =>
        tx.select().from(s.members).where(eq(s.members.id, memberId)),
      );
      assert.equal(member.branchName, "Computer Science");
      assert.equal(member.branchCode, "CSE");
      const edited = await request(
        `platform/organizations/${org.id}/students/${memberId}`,
        "PATCH",
        {
          name: "Student manual",
          email: "manual@branches.example.test",
          phone: "9876543210",
          branchCode: "ECE",
          branchName: "Electronics",
        },
      );
      assert.equal(edited.status, 400);
    },
  );
  await t.test(
    "approval rechecks the catalog and public RLS rejects raw mismatched branch pairs",
    async () => {
      const [invalid] = await scoped(connection.db, { platform: true }, (tx) =>
        tx
          .insert(registrationRequests)
          .values({
            ...student("legacy-invalid", { branchCode: "UNKNOWN" }),
            source: "import",
          })
          .returning(),
      );
      const before = await counts();
      const result = await request("platform/registrations/approve", "POST", {
        ids: [invalid.id],
      });
      assert.equal(result.body.results[0].status, "failed");
      assert.deepEqual(await counts(), before);
      await assert.rejects(
        connection.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL ROLE slate_registration`);
          await tx.execute(
            sql`select set_config('slate.org_id', ${org.id}, true), set_config('slate.is_platform', 'false', true)`,
          );
          await tx
            .insert(registrationRequests)
            .values({
              ...student("raw-mismatch", { branchName: "Spoofed name" }),
              source: "registration",
            });
        }),
      );
    },
  );
  await t.test(
    "empty branches are selectable in access and announcements; neither path invents branches",
    async () => {
      assert.equal(
        (await request(path, "POST", { code: "me/2026", name: "Mechanical" }))
          .status,
        201,
      );
      const workspacePath = `platform/organizations/${org.id}/access`;
      const workspace = await request(workspacePath);
      assert.equal(
        workspace.body.branches.find(
          (item: { code: string }) => item.code === "ME/2026",
        ).studentCount,
        0,
      );
      for (const body of [
        { scope: "branch", targetId: "UNKNOWN", policy: inheritPolicy() },
        {
          scope: "branch",
          targetId: "CSE",
          branchName: "Renamed by access",
          policy: inheritPolicy(),
        },
        {
          scope: "student",
          targetId: memberId,
          branchCode: "ECE",
          policy: inheritPolicy(),
        },
      ])
        assert.equal(
          (
            await request(workspacePath, "PUT", {
              revision: workspace.body.revision,
              ...body,
            })
          ).status,
          400,
        );
      const audience = await request(
        `platform/announcements/audience?organizationId=${org.id}`,
      );
      assert.deepEqual(
        audience.body.branches
          .map((item: { code: string }) => item.code)
          .sort(),
        ["CSE", "ME/2026"],
      );
      const announcement = {
        clientId: randomUUID(),
        organizationId: org.id,
        branchCode: "ME/2026",
        title: "Test notice",
        body: "Only in-memory data",
        format: "plain",
      };
      assert.equal(
        (await request("platform/announcements", "POST", announcement)).status,
        201,
      );
      assert.equal(
        (
          await request("platform/announcements", "POST", {
            ...announcement,
            clientId: randomUUID(),
            branchCode: "ECE",
          })
        ).status,
        400,
      );
    },
  );
});

test("branch migration backfills canonical legacy identities once and preserves students and progress", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  t.after(() => connection.close());
  await migrateDatabase(connection.db);
  const fixture = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      await tx
        .insert(s.user)
        .values({
          id: "legacy-branch-student",
          name: "Legacy Student",
          email: "legacy-branch@example.test",
        });
      const [org] = await tx
        .insert(s.organizations)
        .values({ name: "Legacy Branch College" })
        .returning();
      const [student] = await tx
        .insert(s.members)
        .values({
          organizationId: org.id,
          authUserId: "legacy-branch-student",
          role: "student",
          branchCode: " cse ",
          branchName: "Computer Scienec",
        })
        .returning();
      await tx.insert(s.accessPolicies).values([
        {
          organizationId: org.id,
          scope: "branch",
          targetKey: "CSE",
          branchName: "Computer Science",
          policy: inheritPolicy(),
        },
        {
          organizationId: org.id,
          scope: "branch",
          targetKey: "ME",
          branchName: "Mechananical Engineering",
          policy: inheritPolicy(),
        },
      ]);
      await tx
        .insert(registrationRequests)
        .values({
          organizationId: org.id,
          studentId: "LEGACY-1",
          name: "Pending Student",
          email: "legacy-pending@example.test",
          phone: "+919876543210",
          branchCode: "cse",
          branchName: "computer science",
          source: "registration",
        });
      await tx
        .insert(s.announcements)
        .values({
          organizationId: org.id,
          clientId: randomUUID(),
          branchCode: "CE",
          branchName: "Civil",
          title: "Legacy notice",
          body: "Keep notice",
          format: "plain",
          createdBy: student.id,
          authorName: "Legacy",
        });
      const [course] = await tx
        .insert(s.courses)
        .values({
          title: "Legacy learning",
          description: "Keep progress",
          track: "general",
          status: "published",
        })
        .returning();
      const [version] = await tx
        .insert(s.versions)
        .values({
          courseId: course.id,
          number: 1,
          title: course.title,
          description: course.description,
          lessons: [],
        })
        .returning();
      await tx
        .insert(s.grants)
        .values({
          organizationId: org.id,
          memberId: student.id,
          courseId: course.id,
          versionId: version.id,
        });
      const [progress] = await tx
        .insert(s.progress)
        .values({
          organizationId: org.id,
          memberId: student.id,
          versionId: version.id,
          lessonId: "legacy-lesson",
        })
        .returning();
      return { org, student, progress };
    },
  );
  await connection.db.execute(
    sql`delete from migrations where id='008-organization-branches'`,
  );
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const saved = await scoped(connection.db, { platform: true }, async (tx) => ({
    branches: await tx
      .select()
      .from(s.organizationBranches)
      .orderBy(s.organizationBranches.code),
    members: await tx.select().from(s.members),
    requests: await tx.select().from(registrationRequests),
    progress: await tx.select().from(s.progress),
    grants: await tx.select().from(s.grants),
  }));
  assert.deepEqual(
    saved.branches.map((row) => [row.code, row.name]),
    [
      ["CE", "Civil"],
      ["CSE", "Computer Science"],
      ["ME", "Mechananical Engineering"],
    ],
  );
  assert.equal(saved.members[0].id, fixture.student.id);
  assert.equal(saved.members[0].branchCode, "CSE");
  assert.equal(saved.members[0].branchName, "Computer Science");
  assert.equal(saved.requests[0].branchCode, "CSE");
  assert.equal(saved.requests[0].branchName, "Computer Science");
  assert.deepEqual(saved.progress, [fixture.progress]);
  assert.equal(saved.grants.length, 1);
  await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.accessPolicies)
      .values({
        organizationId: fixture.org.id,
        scope: "branch",
        targetKey: "UNKNOWN",
        branchName: "Unregistered branch",
        policy: inheritPolicy(),
      }),
  );
  await migrateDatabase(connection.db);
  assert.equal(
    (
      await scoped(connection.db, { platform: true }, (tx) =>
        tx.select().from(s.organizationBranches),
      )
    ).length,
    3,
    "migration reruns must not promote arbitrary later free-text input into branches",
  );
});
