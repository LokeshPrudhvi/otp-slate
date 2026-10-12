import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  featureKeys,
  type AccessPolicy,
  type AccessWorkspace,
} from "@slate/contracts";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import { inheritPolicy } from "./access.js";
import * as s from "./schema.js";

test("organization, branch and student policies enforce live HTTP access without destroying enrollment history", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "access-tests-only-long-secret-32-characters",
    authUrl: "http://localhost:3000",
    origins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
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
        assert.fail("No external phone transport in access tests.");
      },
    },
    true,
  );
  const [org, other] = await scoped(connection.db, { platform: true }, (tx) =>
    tx
      .insert(s.organizations)
      .values([{ name: "Access College" }, { name: "Other College" }])
      .returning(),
  );
  await scoped(connection.db, { platform: true }, tx => tx.insert(s.organizationBranches).values([{ organizationId: org.id, code: "CSE", name: "Computer Science" }, { organizationId: org.id, code: "ME", name: "Mechanical Engineering" }]));
  async function person(
    name: string,
    role: "platform_admin" | "student" | "organization_viewer",
    organizationId: string | null,
    branch: string | null = null,
  ) {
    const identity = await auth.api.createUser({
      body: {
        name,
        email: `${name}@example.test`,
        password: "Access-tests-only!Password2026",
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
          branchCode: branch,
          branchName:
            branch === "CSE"
              ? "Computer Science"
              : branch === "ME"
                ? "Mechanical"
                : null,
          passwordSetupComplete: true,
          phoneVerifiedAt: new Date(),
          features: ["jobs", "resume", "rankings"],
        })
        .returning(),
    );
    const response = await auth.api.signInEmail({
      body: {
        email: identity.user.email,
        password: "Access-tests-only!Password2026",
      },
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
  const admin = await person("access-admin", "platform_admin", null),
    viewer = await person("access-viewer", "organization_viewer", org.id),
    cse = await person("access-cse", "student", org.id, "CSE"),
    mechanical = await person("access-me", "student", org.id, "ME"),
    foreign = await person("access-foreign", "student", other.id, "CSE");
  const [courseA, courseB] = await scoped(
    connection.db,
    { platform: true },
    (tx) =>
      tx
        .insert(s.courses)
        .values([
          {
            title: "Computer science",
            description: "Programming",
            track: "dsa",
            status: "published",
          },
          {
            title: "Mechanical fundamentals",
            description: "Mechanics",
            track: "general",
            status: "published",
          },
        ])
        .returning(),
  );
  const lessonA = randomUUID(),
    lessonB = randomUUID();
  const [versionA, versionB] = await scoped(
    connection.db,
    { platform: true },
    (tx) =>
      tx
        .insert(s.versions)
        .values([
          {
            courseId: courseA.id,
            number: 1,
            title: courseA.title,
            description: courseA.description,
            lessons: [{ id: lessonA, title: "First lesson", body: "A" }],
          },
          {
            courseId: courseB.id,
            number: 1,
            title: courseB.title,
            description: courseB.description,
            lessons: [{ id: lessonB, title: "First lesson", body: "B" }],
          },
        ])
        .returning(),
  );
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  async function request(
    path: string,
    cookie: string,
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
  const path = `platform/organizations/${org.id}/access`;
  async function workspace() {
    const response = await request(path, admin.cookie);
    assert.equal(response.status, 200);
    return response.body as AccessWorkspace;
  }
  async function update(
    scope: "organization" | "branch" | "student",
    policy: AccessPolicy,
    extra: Record<string, unknown> = {},
  ) {
    const current = await workspace();
    const response = await request(path, admin.cookie, "PUT", {
      revision: current.revision,
      scope,
      policy,
      ...extra,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body as AccessWorkspace;
  }
  let organizationPolicy: AccessPolicy = {
    features: [...featureKeys],
    courseIds: [courseA.id, courseB.id],
    practiceModuleIds: ["aptitude", "competitive-coding"],
    toolkitTrackIds: ["dsa"],
  };
  try {
    await t.test("platform summary returns numeric counts and denies other roles", async () => {
      const summary = await request("platform/summary", admin.cookie);
      assert.equal(summary.status, 200);
      assert.deepEqual(summary.body, {
        organizations: 2,
        students: 3,
        viewers: 1,
        publishedCourses: 2,
      });
      assert.equal((await request("platform/summary", viewer.cookie)).status, 403);
      assert.equal((await request("platform/summary", cse.cookie)).status, 403);
    });
    await t.test(
      "read-only previews have no side effects and only Platform Admin can manage policies",
      async () => {
        const current = await workspace();
        assert.equal(current.revision, 0);
        assert.equal(current.students.length, 2);
        assert.equal(current.catalog.courses.length, 2);
        assert.deepEqual(current.catalog.defaults.practiceModuleIds, []);
        assert.deepEqual(current.students[0].baseline.practiceModuleIds, []);
        assert.ok(
          current.catalog.practiceModules.find(
            (item) => item.id === "competitive-coding",
          )!.count >= 200,
        );
        assert.deepEqual(
          (await request("student/courses", cse.cookie)).body,
          [],
        );
        assert.deepEqual(
          (await request("student/practice", cse.cookie)).body,
          [],
        );
        assert.equal((await request(path, viewer.cookie)).status, 403);
        assert.equal(
          (
            await request(path, cse.cookie, "PUT", {
              revision: 0,
              scope: "organization",
              policy: organizationPolicy,
            })
          ).status,
          403,
        );
        assert.equal((await workspace()).revision, 0);
      },
    );
    await t.test(
      "invalid courses, unknown fields and cross-organization students roll back the entire update",
      async () => {
        for (const body of [
          {
            revision: 0,
            scope: "organization",
            policy: { ...organizationPolicy, courseIds: [randomUUID()] },
          },
          {
            revision: 0,
            scope: "student",
            targetId: foreign.id,
            policy: inheritPolicy(),
          },
          {
            revision: 0,
            scope: "organization",
            policy: organizationPolicy,
            role: "platform_admin",
          },
        ])
          assert.ok(
            [400, 404].includes(
              (await request(path, admin.cookie, "PUT", body)).status,
            ),
          );
        assert.equal((await workspace()).revision, 0);
        assert.equal(
          (
            await scoped(connection.db, { platform: true }, (tx) =>
              tx.select().from(s.accessPolicies),
            )
          ).length,
          0,
        );
      },
    );
    await t.test(
      "branch course selections and labeled sample practice take effect immediately; new students inherit",
      async () => {
        await update("organization", organizationPolicy, {
          display: {
            portalTitle: "Campus learning",
            toolkitTitle: "Learning paths",
            welcomeText: "Welcome to your campus.",
          },
        });
        await update(
          "branch",
          { ...inheritPolicy(), courseIds: [courseA.id] },
          { targetId: "cse", branchName: "Computer Science" },
        );
        await update(
          "branch",
          {
            ...inheritPolicy(),
            courseIds: [courseB.id],
            features: ["courses", "inbox"],
          },
          { targetId: "ME", branchName: "Mechanical Engineering" },
        );
        assert.deepEqual(
          (await request("student/courses", cse.cookie)).body.map(
            (course: any) => course.id,
          ),
          [courseA.id],
        );
        assert.deepEqual(
          (await request("student/courses", mechanical.cookie)).body.map(
            (course: any) => course.id,
          ),
          [courseB.id],
        );
        assert.equal(
          (await request(`student/courses/${courseA.id}`, mechanical.cookie))
            .status,
          403,
        );
        assert.equal(
          (await request("student/compiler", mechanical.cookie)).status,
          403,
        );
        assert.equal(
          (await request("student/compiler", cse.cookie)).status,
          200,
        );
        const practice = await request("student/practice", cse.cookie);
        assert.equal(practice.status, 200);
        assert.ok(practice.body.length > 200);
        assert.ok(practice.body.every((item: any) => item.sample === true));
        assert.ok(!practice.body.some((item: any) => item.id === "reasoning"));
        const newer = await person("access-new", "student", org.id, "CSE");
        assert.deepEqual(
          (await request("student/courses", newer.cookie)).body.map(
            (course: any) => course.id,
          ),
          [courseA.id],
        );
        const analytics = await request(
          "organization/analytics",
          viewer.cookie,
        );
        assert.equal(analytics.status, 200);
        assert.equal(analytics.body.totals.assignedCourses, 3);
        assert.equal(
          analytics.body.students.find((item: any) => item.id === newer.id)
            .assignedCourses,
          1,
        );
        const me = await request("me?portal=student", cse.cookie);
        assert.equal(me.body.access.display.portalTitle, "Campus learning");
        assert.equal(me.body.courseVersionIds, undefined);
        const configured = await workspace();
        assert.deepEqual(
          configured.students.find((item) => item.id === cse.id)!.baseline
            .courseIds,
          [],
        );
        assert.deepEqual(
          configured.students.find((item) => item.id === cse.id)!.baseline
            .practiceModuleIds,
          [],
        );
        assert.deepEqual(
          configured.students.find((item) => item.id === cse.id)!.effective
            .courseIds,
          [courseA.id],
        );
        assert.deepEqual(
          (await request("student/courses", foreign.cookie)).body,
          [],
        );
      },
    );
    await t.test(
      "optimistic revisions reject concurrent saves; branch reassignment is atomic with policy",
      async () => {
        const before = await workspace();
        await update("student", inheritPolicy(), {
          targetId: cse.id,
          branchCode: "ME",
        });
        assert.deepEqual(
          (await request("student/courses", cse.cookie)).body.map(
            (course: any) => course.id,
          ),
          [courseB.id],
        );
        assert.equal(
          (
            await request(path, admin.cookie, "PUT", {
              revision: before.revision,
              scope: "organization",
              policy: organizationPolicy,
            })
          ).status,
          409,
        );
        const latest = await workspace();
        assert.equal(
          (
            await request(path, admin.cookie, "PUT", {
              revision: latest.revision,
              scope: "student",
              targetId: cse.id,
              branchCode: "UNKNOWN",
              policy: { ...inheritPolicy(), courseIds: [] },
            })
          ).status,
          400,
        );
        assert.equal((await workspace()).revision, latest.revision);
        await update("student", inheritPolicy(), {
          targetId: cse.id,
          branchCode: "CSE",
        });
      },
    );
    await t.test(
      "course updates stay pinned, revocation blocks direct URLs and restoration keeps progress",
      async () => {
        assert.equal(
          (
            await request(
              `student/courses/${courseA.id}/lessons/${lessonA}/complete`,
              cse.cookie,
              "POST",
            )
          ).status,
          201,
        );
        await scoped(connection.db, { platform: true }, (tx) =>
          tx.insert(s.versions).values({
            courseId: courseA.id,
            number: 2,
            title: "New computer science",
            description: "Second edition",
            lessons: [{ id: randomUUID(), title: "New lesson", body: "V2" }],
          }),
        );
        let detail = await request(`student/courses/${courseA.id}`, cse.cookie);
        assert.equal(detail.body.versionId, versionA.id);
        assert.deepEqual(detail.body.completedLessonIds, [lessonA]);
        await update(
          "branch",
          { ...inheritPolicy(), courseIds: [] },
          { targetId: "CSE" },
        );
        assert.equal(
          (await request(`student/courses/${courseA.id}`, cse.cookie)).status,
          403,
        );
        assert.equal(
          (
            await request(
              `student/courses/${courseA.id}/lessons/${lessonA}/complete`,
              cse.cookie,
              "POST",
            )
          ).status,
          403,
        );
        await update(
          "branch",
          { ...inheritPolicy(), courseIds: [courseA.id] },
          { targetId: "CSE" },
        );
        detail = await request(`student/courses/${courseA.id}`, cse.cookie);
        assert.equal(detail.body.versionId, versionA.id);
        assert.deepEqual(detail.body.completedLessonIds, [lessonA]);
        assert.equal(
          (
            await request("platform/assignments", admin.cookie, "POST", {
              memberId: cse.id,
              courseId: courseB.id,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "organization ceilings overrule saved student overrides and all direct feature routes",
      async () => {
        await update(
          "student",
          {
            ...inheritPolicy(),
            features: [...featureKeys],
            courseIds: [courseA.id],
            practiceModuleIds: ["competitive-coding"],
          },
          { targetId: cse.id },
        );
        const closed = {
          ...organizationPolicy,
          features: [],
          courseIds: [],
          practiceModuleIds: [],
          toolkitTrackIds: [],
        };
        await update("organization", closed);
        for (const endpoint of [
          "student/courses",
          `student/courses/${courseA.id}`,
          "student/practice",
          "student/exams",
          "student/compiler",
          "student/announcements",
          "student/jobs",
          "student/rankings",
          "student/resume",
          "mailbox",
          "mailbox/contacts",
        ])
          assert.equal(
            (await request(endpoint, cse.cookie)).status,
            403,
            endpoint,
          );
        assert.equal(
          (await request("student/submissions", cse.cookie, "POST", {})).status,
          403,
        );
        assert.equal(
          (
            await request("mailbox", cse.cookie, "POST", {
              clientId: randomUUID(),
              subject: "No access",
              body: "Blocked",
              recipientIds: [mechanical.id],
              broadcast: false,
            })
          ).status,
          403,
        );
        const current = await workspace();
        assert.equal(
          (
            await request(path, admin.cookie, "PUT", {
              revision: current.revision,
              scope: "student",
              targetId: mechanical.id,
              policy: { ...inheritPolicy(), features: ["compiler"] },
            })
          ).status,
          400,
        );
        // Existing overridden selections are clipped on the next explicit save after a ceiling narrows.
        const clipped = await update(
          "student",
          current.students.find((item) => item.id === cse.id)!.policy,
          { targetId: cse.id },
        );
        assert.deepEqual(
          clipped.students.find((item) => item.id === cse.id)!.policy.features,
          [],
        );
        assert.deepEqual(
          clipped.students.find((item) => item.id === cse.id)!.policy.courseIds,
          [],
        );
        assert.deepEqual(
          (await request("me?portal=student", cse.cookie)).body.features,
          [],
        );
        assert.equal(
          (
            await request("platform/members/" + cse.id, admin.cookie, "PATCH", {
              features: ["jobs", "resume", "rankings"],
            })
          ).status,
          200,
        );
        assert.equal((await request("student/jobs", cse.cookie)).status, 403);
        assert.equal(
          (await request("organization/analytics", viewer.cookie)).body.totals
            .assignedCourses,
          0,
        );
        await update("organization", organizationPolicy);
        await update("student", inheritPolicy(), { targetId: cse.id });
      },
    );
    await t.test(
      "editing another branch category clips formerly allowed features and courses, while new blocked choices fail",
      async () => {
        await update(
          "branch",
          {
            features: ["courses", "compiler"],
            courseIds: [courseA.id],
            practiceModuleIds: ["competitive-coding"],
            toolkitTrackIds: ["dsa"],
          },
          { targetId: "CSE" },
        );
        await update("organization", {
          features: ["courses", "inbox"],
          courseIds: [courseB.id],
          practiceModuleIds: ["aptitude"],
          toolkitTrackIds: [],
        });
        const before = await workspace();
        const policy = before.branches.find(
          (branch) => branch.code === "CSE",
        )!.policy;
        assert.deepEqual(policy.features, ["courses", "compiler"]);
        assert.deepEqual(policy.courseIds, [courseA.id]);
        const saved = await update(
          "branch",
          { ...policy, practiceModuleIds: ["aptitude"] },
          { targetId: "CSE" },
        );
        const result = saved.branches.find(
          (branch) => branch.code === "CSE",
        )!.policy;
        assert.deepEqual(result, {
          features: ["courses"],
          courseIds: [],
          practiceModuleIds: ["aptitude"],
          toolkitTrackIds: [],
        });
        assert.equal(saved.revision, before.revision + 1);
        for (const forbidden of [
          { ...result, features: ["courses", "compiler"] },
          { ...result, courseIds: [courseA.id] },
        ]) {
          assert.equal(
            (
              await request(path, admin.cookie, "PUT", {
                revision: saved.revision,
                scope: "branch",
                targetId: "CSE",
                policy: forbidden,
              })
            ).status,
            400,
          );
          assert.equal((await workspace()).revision, saved.revision);
        }
        await update("organization", organizationPolicy);
        await update("branch", inheritPolicy(), { targetId: "CSE" });
      },
    );
    await t.test(
      "tenant roles cannot read other organization policies or write access policies",
      async () => {
        await assert.rejects(
          scoped(
            connection.db,
            { authId: cse.authUserId, organizationId: org.id },
            (tx) =>
              tx.insert(s.accessPolicies).values({
                organizationId: org.id,
                scope: "student",
                targetKey: randomUUID(),
                policy: inheritPolicy(),
              }),
          ),
        );
        const rows = await scoped(
          connection.db,
          { authId: foreign.authUserId, organizationId: other.id },
          (tx) => tx.select().from(s.accessPolicies),
        );
        assert.deepEqual(rows, []);
        await assert.rejects(
          scoped(
            connection.db,
            { organizationId: org.id, readonly: true },
            (tx) =>
              tx.update(s.accessPolicies).set({ policy: inheritPolicy() }),
          ),
        );
      },
    );
    await t.test(
      "passive identity polling preserves idle expiry while active navigation refreshes it",
      async () => {
        const past = new Date(Date.now() - 5 * 60_000);
        await connection.db
          .update(s.session)
          .set({ updatedAt: past })
          .where(eq(s.session.userId, cse.authUserId));
        assert.equal(
          (await request("me?portal=student&passive=1", cse.cookie)).status,
          200,
        );
        const [session] = await connection.db
          .select()
          .from(s.session)
          .where(eq(s.session.userId, cse.authUserId));
        assert.equal(session.updatedAt.getTime(), past.getTime());
        assert.equal(
          (await request("student/compiler", cse.cookie)).status,
          200,
        );
        const [refreshed] = await connection.db
          .select()
          .from(s.session)
          .where(eq(s.session.userId, cse.authUserId));
        assert.ok(refreshed.updatedAt > past);
        assert.equal((await request("student/compiler", cse.cookie)).status, 200);
        const [unchanged] = await connection.db
          .select()
          .from(s.session)
          .where(eq(s.session.userId, cse.authUserId));
        assert.equal(unchanged.updatedAt.getTime(), refreshed.updatedAt.getTime());
        await connection.db
          .update(s.session)
          .set({ updatedAt: new Date(Date.now() - 31 * 60_000) })
          .where(eq(s.session.userId, cse.authUserId));
        assert.equal(
          (await request("me?portal=student&passive=1", cse.cookie)).status,
          401,
        );
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
