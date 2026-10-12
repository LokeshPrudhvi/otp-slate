import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, getTableColumns, sql } from "drizzle-orm";
import { AccessService, inheritPolicy } from "./access.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { jsonRows } from "./json-query.js";
import type { Actor, SlateService } from "./service.js";
import * as s from "./schema.js";

test("batched access reads retain timestamp decoding, expiration, pins and tenant isolation", async () => {
  const connection = await connectDatabase("pglite://memory");
  try {
    await migrateDatabase(connection.db);
    const [organization, other] = await scoped(
      connection.db,
      { platform: true },
      (tx) =>
        tx
          .insert(s.organizations)
          .values([{ name: "Read Model College" }, { name: "Another College" }])
          .returning(),
    );
    const studentId = randomUUID(),
      foreignId = randomUUID();
    await connection.db.insert(s.user).values([
      { id: studentId, name: "Student", email: "access-read@example.test" },
      { id: foreignId, name: "Other", email: "access-other@example.test" },
    ]);
    const [member, foreign] = await scoped(
      connection.db,
      { platform: true },
      (tx) =>
        tx
          .insert(s.members)
          .values([
            {
              authUserId: studentId,
              organizationId: organization.id,
              role: "student",
              branchCode: "CSE",
            },
            {
              authUserId: foreignId,
              organizationId: other.id,
              role: "student",
            },
          ])
          .returning(),
    );
    const [active, expired, upcoming] = await scoped(
      connection.db,
      { platform: true },
      (tx) =>
        tx
          .insert(s.courses)
          .values([
            {
              title: "Active",
              description: "Active course",
              track: "general",
              status: "published",
            },
            {
              title: "Expired",
              description: "Expired grant",
              track: "general",
              status: "published",
            },
            {
              title: "Upcoming",
              description: "Future expiration",
              track: "general",
              status: "published",
            },
          ])
          .returning(),
    );
    const [activeV1, activeV2, expiredV1, upcomingV1] = await scoped(
      connection.db,
      { platform: true },
      (tx) =>
        tx
          .insert(s.versions)
          .values([
            {
              courseId: active.id,
              title: "Active",
              description: "First",
              number: 1,
              lessons: [],
            },
            {
              courseId: active.id,
              title: "Active",
              description: "Second",
              number: 2,
              lessons: [],
            },
            {
              courseId: expired.id,
              title: "Expired",
              description: "First",
              number: 1,
              lessons: [],
            },
            {
              courseId: upcoming.id,
              title: "Upcoming",
              description: "First",
              number: 1,
              lessons: [],
            },
          ])
          .returning(),
    );
    const past = new Date(Date.now() - 60_000),
      future = new Date(Date.now() + 3_600_000);
    await scoped(connection.db, { platform: true }, (tx) =>
      tx.insert(s.grants).values([
        {
          organizationId: organization.id,
          memberId: member.id,
          courseId: active.id,
          versionId: activeV1.id,
          expiresAt: null,
        },
        {
          organizationId: organization.id,
          memberId: member.id,
          courseId: expired.id,
          versionId: expiredV1.id,
          expiresAt: past,
        },
        {
          organizationId: organization.id,
          memberId: member.id,
          courseId: upcoming.id,
          versionId: upcomingV1.id,
          expiresAt: future,
        },
        {
          organizationId: other.id,
          memberId: foreign.id,
          courseId: active.id,
          versionId: activeV2.id,
          expiresAt: null,
        },
      ]),
    );
    const service = {
      scope: (_actor: Actor, work: Parameters<typeof scoped>[2]) =>
        scoped(connection.db, { platform: true }, work),
      local: false,
      config: { production: false },
    } as unknown as SlateService;
    const access = new AccessService(service);
    const context = { authId: studentId, organizationId: organization.id };

    const [decoded] = await scoped(connection.db, context, (tx) =>
      tx
        .select({
          grants: jsonRows(getTableColumns(s.grants), sql`from ${s.grants}`),
          absent: jsonRows(
            getTableColumns(s.accessPolicies),
            sql`from ${s.accessPolicies}`,
          ),
        })
        .from(sql`(values (true)) as snapshot`),
    );
    assert.equal(
      decoded.grants.length,
      3,
      "foreign grants remain excluded by RLS inside JSON aggregates",
    );
    assert.deepEqual(decoded.absent, []);
    const expiresAt = decoded.grants.find(
      (grant) => grant.courseId === upcoming.id,
    )?.expiresAt;
    assert.ok(expiresAt instanceof Date);
    assert.equal(expiresAt.toISOString(), future.toISOString());
    assert.equal(
      decoded.grants.find((grant) => grant.courseId === active.id)?.expiresAt,
      null,
    );
    assert.ok(decoded.grants.every((grant) => grant.createdAt instanceof Date));

    const result = await scoped(connection.db, context, (tx) =>
      access.resolve(tx, member, false, organization),
    );
    assert.deepEqual(
      new Set(result.effective.courseIds),
      new Set([active.id, upcoming.id]),
    );
    assert.equal(
      result.versionIds[active.id],
      activeV1.id,
      "the existing enrollment remains pinned to v1",
    );
    assert.equal(result.versionIds[expired.id], undefined);
    assert.deepEqual(result.effective.practiceModuleIds, []);

    const workspace = await access.workspace(
      { role: "platform_admin" } as Actor,
      organization.id,
    );
    assert.equal(workspace.students.length, 1);
    assert.deepEqual(
      new Set(workspace.students[0].effective.courseIds),
      new Set([active.id, upcoming.id]),
    );
    assert.deepEqual(workspace.students[0].policy, inheritPolicy());
    assert.equal(
      workspace.catalog.courses.find((course) => course.id === active.id)
        ?.version,
      2,
    );
    assert.equal(
      workspace.catalog.courses.filter((course) => course.id === active.id)
        .length,
      1,
    );
    assert.deepEqual(
      workspace.catalog.courses.map((course) => course.title),
      ["Active", "Expired", "Upcoming"],
    );

    await scoped(connection.db, { platform: true }, (tx) =>
      tx.insert(s.accessPolicies).values([
        {
          organizationId: organization.id,
          scope: "organization",
          targetKey: "organization",
          policy: { ...inheritPolicy(), courseIds: [active.id] },
          courseVersions: { [active.id]: activeV2.id },
        },
        {
          organizationId: organization.id,
          scope: "student",
          targetKey: member.id,
          policy: inheritPolicy(),
        },
        {
          organizationId: other.id,
          scope: "organization",
          targetKey: "organization",
          policy: { ...inheritPolicy(), courseIds: [] },
        },
      ]),
    );
    const inherited = await scoped(connection.db, context, (tx) =>
      access.resolve(tx, member, false, organization),
    );
    assert.deepEqual(
      inherited.effective.courseIds,
      [active.id],
      "null student course selection inherits the organization ceiling",
    );
    assert.equal(inherited.versionIds[active.id], activeV1.id);
    await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .update(s.accessPolicies)
        .set({ policy: { ...inheritPolicy(), courseIds: [] } })
        .where(eq(s.accessPolicies.targetKey, member.id)),
    );
    const empty = await scoped(connection.db, context, (tx) =>
      access.resolve(tx, member, false, organization),
    );
    assert.deepEqual(
      empty.effective.courseIds,
      [],
      "an explicit empty selection must not become inheritance",
    );
    await assert.rejects(
      access.workspace({ role: "platform_admin" } as Actor, randomUUID()),
      /Organization not found/,
    );
  } finally {
    await connection.close();
  }
});
