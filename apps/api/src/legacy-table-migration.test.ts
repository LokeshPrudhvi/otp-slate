import { test } from "node:test";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import * as s from "./schema.js";

test("legacy domain table migration preserves records and relationships and can be rerun", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  t.after(() => connection.close());
  await migrateDatabase(connection.db);
  const memberId = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      await tx
        .insert(s.user)
        .values({
          id: "legacy-student",
          name: "Legacy Student",
          email: "legacy@example.test",
        });
      const [org] = await tx
        .insert(s.organizations)
        .values({ name: "Legacy College" })
        .returning();
      const [member] = await tx
        .insert(s.members)
        .values({
          authUserId: "legacy-student",
          organizationId: org.id,
          role: "student",
          studentId: "EXISTING-01",
        })
        .returning();
      const [course] = await tx
        .insert(s.courses)
        .values({
          title: "Legacy Course",
          description: "Existing coursework",
          track: "foundation",
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
          memberId: member.id,
          courseId: course.id,
          versionId: version.id,
        });
      return member.id;
    },
  );
  const renamed = [
    ["organizations", "slate_organizations"],
    ["members", "slate_members"],
    ["courses", "slate_courses"],
    ["course_versions", "slate_course_versions"],
    ["course_enrollments", "slate_grants"],
    ["lesson_progress", "slate_progress"],
    ["jobs", "slate_jobs"],
    ["resumes", "slate_resumes"],
    ["phone_challenges", "slate_phone_challenges"],
    ["outbox", "slate_outbox"],
    ["audit_logs", "slate_audit"],
    ["messages", "slate_messages"],
    ["message_deliveries", "slate_message_deliveries"],
    ["migrations", "slate_migrations"],
  ];
  for (const [canonical, legacy] of renamed)
    await connection.db.execute(
      sql.raw(`ALTER TABLE ${canonical} RENAME TO ${legacy}`),
    );
  await migrateDatabase(connection.db);
  await migrateDatabase(connection.db);
  const records = await scoped(
    connection.db,
    { platform: true },
    async (tx) => ({
      members: await tx.select().from(s.members),
      grants: await tx
        .select()
        .from(s.grants)
        .where(eq(s.grants.memberId, memberId)),
    }),
  );
  assert.equal(records.members.length, 1);
  assert.equal(records.members[0].id, memberId);
  assert.equal(records.members[0].studentId, "EXISTING-01");
  assert.equal(records.grants.length, 1);
  assert.equal(records.grants[0].memberId, memberId);
  for (const [canonical, legacy] of renamed) {
    const result = await connection.db.execute(
      sql`select to_regclass(${`public.${canonical}`}) as canonical, to_regclass(${`public.${legacy}`}) as legacy`,
    );
    assert.ok(result.rows[0].canonical);
    assert.equal(result.rows[0].legacy, null);
  }
});

test("migration refuses ambiguous legacy and canonical tables without changing existing rows", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  t.after(() => connection.close());
  await migrateDatabase(connection.db);
  await connection.db.execute(
    sql`CREATE TABLE slate_organizations (id integer PRIMARY KEY, name text NOT NULL)`,
  );
  await connection.db.execute(
    sql`INSERT INTO slate_organizations VALUES (1, 'Preserve this legacy row')`,
  );
  await assert.rejects(
    () => migrateDatabase(connection.db),
    /Both legacy and canonical organizations tables exist/,
  );
  const rows = await connection.db.execute(
    sql`SELECT name FROM slate_organizations WHERE id=1`,
  );
  assert.equal(rows.rows[0].name, "Preserve this legacy row");
});
