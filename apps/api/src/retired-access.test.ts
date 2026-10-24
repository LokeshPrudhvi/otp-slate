import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { AccessPolicy, PortalDisplay } from "@slate/contracts";
import { AccessService, inheritPolicy, updateAccessInput } from "./access.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { retiredAccessMigration } from "./retired-access-migration.js";
import type { Actor, SlateService } from "./service.js";
import * as s from "./schema.js";

test("retired access preferences are hidden before migration and safely removed without losing learning", async () => {
  const connection = await connectDatabase("pglite://memory");
  try {
    await migrateDatabase(connection.db);
    const fixture = await scoped(
      connection.db,
      { platform: true },
      async (tx) => {
        const [organization, untouched] = await tx
          .insert(s.organizations)
          .values([
            {
              name: "Legacy Access College",
              portalDisplay: {
                portalTitle: "Learning portal",
                welcomeText: "Keep learning",
                toolkitTitle: "Placement",
              } as PortalDisplay,
            },
            { name: "Unaffected College" },
          ])
          .returning();
        await tx
          .insert(s.organizationBranches)
          .values({
            organizationId: organization.id,
            code: "CSE",
            name: "Computer Science",
          });
        const authId = randomUUID();
        await tx
          .insert(s.user)
          .values({
            id: authId,
            name: "Legacy Student",
            email: "legacy-access@example.test",
          });
        const [member] = await tx
          .insert(s.members)
          .values({
            authUserId: authId,
            organizationId: organization.id,
            role: "student",
            branchCode: "CSE",
            features: ["jobs", "toolkit"],
          })
          .returning();
        const [course] = await tx
          .insert(s.courses)
          .values({
            title: "Assigned course",
            description: "Keep this",
            track: "general",
            status: "published",
          })
          .returning();
        const lessonId = randomUUID();
        const [version] = await tx
          .insert(s.versions)
          .values({
            courseId: course.id,
            number: 1,
            title: course.title,
            description: course.description,
            lessons: [
              { id: lessonId, title: "Lesson", body: "Retain progress" },
            ],
          })
          .returning();
        const [grant] = await tx
          .insert(s.grants)
          .values({
            organizationId: organization.id,
            memberId: member.id,
            courseId: course.id,
            versionId: version.id,
          })
          .returning();
        const [progress] = await tx
          .insert(s.progress)
          .values({
            organizationId: organization.id,
            memberId: member.id,
            versionId: version.id,
            lessonId,
          })
          .returning();
        const [organizationPolicy, branchPolicy, studentPolicy] = await tx
          .insert(s.accessPolicies)
          .values([
            {
              organizationId: organization.id,
              scope: "organization",
              targetKey: "organization",
              policy: {
                features: ["courses", "practice", "crt", "toolkit"],
                courseIds: [course.id],
                practiceModuleIds: ["aptitude"],
                toolkitTrackIds: ["dsa"],
              } as unknown as AccessPolicy,
              courseVersions: { [course.id]: version.id },
            },
            {
              organizationId: organization.id,
              scope: "branch",
              targetKey: "CSE",
              branchName: "Computer Science",
              policy: {
                ...inheritPolicy(),
                toolkitTrackIds: null,
              } as AccessPolicy,
            },
            {
              organizationId: organization.id,
              scope: "student",
              targetKey: member.id,
              policy: {
                ...inheritPolicy(),
                toolkitTrackIds: [],
              } as AccessPolicy,
            },
          ])
          .returning();
        return {
          organization,
          untouched,
          member,
          course,
          version,
          grant,
          progress,
          organizationPolicy,
          branchPolicy,
          studentPolicy,
        };
      },
    );
    const service = {
      scope: (_actor: Actor, work: Parameters<typeof scoped>[2]) =>
        scoped(connection.db, { platform: true }, work),
      local: false,
      config: { production: false },
    } as unknown as SlateService;
    const access = new AccessService(service);
    const admin = { role: "platform_admin" } as Actor;
    const before = await access.workspace(admin, fixture.organization.id);
    assert.doesNotMatch(JSON.stringify(before), /toolkit/i);
    assert.deepEqual(before.display, {
      portalTitle: "Learning portal",
      welcomeText: "Keep learning",
    });
    assert.deepEqual(before.organizationPolicy.features, [
      "courses",
      "practice",
      "crt",
    ]);
    assert.deepEqual(before.branches[0].policy, inheritPolicy());
    assert.deepEqual(before.students[0].policy, inheritPolicy());
    assert.deepEqual(before.students[0].effective.features, [
      "courses",
      "practice",
      "crt",
    ]);
    assert.deepEqual(before.students[0].effective.courseIds, [
      fixture.course.id,
    ]);
    assert.deepEqual(before.students[0].effective.practiceModuleIds, []);
    for (const policy of [
      { ...inheritPolicy(), features: ["toolkit"] },
      { ...inheritPolicy(), toolkitTrackIds: [] },
    ]) {
      assert.equal(
        updateAccessInput.safeParse({
          revision: 0,
          scope: "organization",
          policy,
        }).success,
        false,
      );
    }
    assert.equal(
      updateAccessInput.safeParse({
        revision: 0,
        scope: "organization",
        policy: inheritPolicy(),
        display: { ...before.display, toolkitTitle: "Old" },
      }).success,
      false,
    );

    // Simulate upgrading an existing database. This test never connects to Neon.
    await connection.db.execute(
      sql`delete from migrations where id='014-retired-access-preferences'`,
    );
    await connection.db.transaction((tx) =>
      tx.execute(sql.raw(retiredAccessMigration)),
    );
    const snapshot = () =>
      scoped(connection.db, { platform: true }, async (tx) => ({
        organizations: await tx.select().from(s.organizations),
        members: await tx.select().from(s.members),
        policies: await tx.select().from(s.accessPolicies),
        grants: await tx.select().from(s.grants),
        progress: await tx.select().from(s.progress),
        versions: await tx.select().from(s.versions),
      }));
    const migrated = await snapshot();
    assert.doesNotMatch(JSON.stringify(migrated), /toolkit/i);
    assert.deepEqual(migrated.grants, [fixture.grant]);
    assert.deepEqual(migrated.progress, [fixture.progress]);
    assert.deepEqual(migrated.versions, [fixture.version]);
    assert.deepEqual(
      migrated.policies.find((row) => row.scope === "organization")!
        .courseVersions,
      fixture.organizationPolicy.courseVersions,
    );
    assert.deepEqual(migrated.members[0].features, ["jobs"]);
    assert.equal(
      migrated.organizations.find((row) => row.id === fixture.organization.id)!
        .accessRevision,
      1,
    );
    assert.deepEqual(
      migrated.organizations.find((row) => row.id === fixture.untouched.id),
      fixture.untouched,
    );
    const after = await access.workspace(admin, fixture.organization.id);
    assert.deepEqual(after.organizationPolicy, before.organizationPolicy);
    assert.deepEqual(after.students[0].effective, {
      ...before.students[0].effective,
      revision: 1,
    });
    await connection.db.transaction((tx) =>
      tx.execute(sql.raw(retiredAccessMigration)),
    );
    assert.deepEqual(
      await snapshot(),
      migrated,
      "rerunning cleanup must not change revisions or learning history",
    );
  } finally {
    await connection.close();
  }
});
