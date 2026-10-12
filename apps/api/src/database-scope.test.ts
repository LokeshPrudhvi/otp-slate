import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import * as s from "./schema.js";

function denied(error: unknown): boolean {
  let current = error;
  while (current && typeof current === "object") {
    if ("code" in current && current.code === "42501") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

test("scoped transactions retain role restrictions and isolate tenant context", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  t.after(() => connection.close());
  await migrateDatabase(connection.db);
  const db = connection.db;
  const authA = randomUUID();
  const authB = randomUUID();
  const [orgA, orgB] = await scoped(db, { platform: true }, async (tx) => {
    await tx.insert(s.user).values([
      { id: authA, name: "Student A", email: "scope-a@example.test" },
      { id: authB, name: "Student B", email: "scope-b@example.test" },
    ]);
    return tx.insert(s.organizations).values([
      { name: "Scope College A" },
      { name: "Scope College B" },
    ]).returning();
  });
  const [memberA, memberB] = await scoped(db, { platform: true }, (tx) =>
    tx.insert(s.members).values([
      { authUserId: authA, organizationId: orgA.id, role: "student" },
      { authUserId: authB, organizationId: orgB.id, role: "student" },
    ]).returning(),
  );
  const baseline = (await db.execute(sql`select current_user as role`)).rows[0].role;
  async function assertOutsideContextCleared() {
    const result = await db.execute(sql`
      select current_user as role,
        nullif(current_setting('slate.auth_id', true), '') as auth_id,
        nullif(current_setting('slate.org_id', true), '') as org_id,
        nullif(current_setting('slate.is_platform', true), '') as platform
    `);
    assert.deepEqual(result.rows[0], {
      role: baseline, auth_id: null, org_id: null, platform: null,
    });
  }

  await t.test("runtime role reads and writes only the current organization", async () => {
    await scoped(db, { authId: authA, organizationId: orgA.id }, async (tx) => {
      assert.equal((await tx.execute(sql`select current_user as role`)).rows[0].role, "slate_runtime");
      assert.deepEqual((await tx.select().from(s.organizations)).map((row) => row.id), [orgA.id]);
      assert.deepEqual((await tx.select().from(s.members)).map((row) => row.id), [memberA.id]);
      assert.equal((await tx.update(s.organizations).set({ name: "Invisible update" })
        .where(eq(s.organizations.id, orgB.id)).returning()).length, 0);
      await tx.insert(s.jobs).values({
        organizationId: orgA.id, title: "Allowed job", company: "Example",
        description: "Scoped job", url: "https://example.test/job",
      });
    });
    await assert.rejects(scoped(db, { authId: authA, organizationId: orgA.id }, (tx) =>
      tx.insert(s.jobs).values({
        organizationId: orgB.id, title: "Forbidden job", company: "Example",
        description: "Wrong organization", url: "https://example.test/job",
      })), denied);
    await assertOutsideContextCleared();
  });

  await t.test("platform access cannot leak into a following unscoped or tenant request", async () => {
    await scoped(db, { platform: true }, async (tx) => {
      assert.equal((await tx.select().from(s.organizations)).length, 2);
      assert.equal((await tx.select().from(s.members)).length, 2);
    });
    await scoped(db, {}, async (tx) => {
      assert.equal((await tx.select().from(s.organizations)).length, 0);
      assert.equal((await tx.select().from(s.members)).length, 0);
      assert.equal((await tx.execute(sql`select current_setting('slate.is_platform') as value`)).rows[0].value, "false");
    });
    await scoped(db, { authId: authB }, async (tx) => {
      assert.deepEqual((await tx.select().from(s.members)).map((row) => row.id), [memberB.id]);
      assert.equal((await tx.select().from(s.organizations)).length, 0);
    });
    await scoped(db, { authId: authB, organizationId: orgB.id }, async (tx) => {
      assert.deepEqual((await tx.select().from(s.organizations)).map((row) => row.id), [orgB.id]);
      assert.equal((await tx.select().from(s.jobs)).length, 0);
    });
    await assertOutsideContextCleared();
  });

  await t.test("reader is read-only even when platform context is enabled", async () => {
    await scoped(db, { organizationId: orgA.id, readonly: true }, async (tx) => {
      assert.equal((await tx.execute(sql`select current_user as role`)).rows[0].role, "slate_reader");
      assert.deepEqual((await tx.select().from(s.organizations)).map((row) => row.id), [orgA.id]);
    });
    await assert.rejects(scoped(db, { platform: true, readonly: true }, (tx) =>
      tx.update(s.members).set({ status: "disabled" }).where(eq(s.members.id, memberA.id))), denied);
    await assertOutsideContextCleared();
  });

  await t.test("mailbox permits own messages but cannot manage students or cross tenants", async () => {
    const context = { authId: authA, organizationId: orgA.id, mailbox: true };
    await scoped(db, context, async (tx) => {
      assert.equal((await tx.execute(sql`select current_user as role`)).rows[0].role, "slate_mailbox");
      assert.deepEqual((await tx.select({ id: s.members.id }).from(s.members)).map((row) => row.id), [memberA.id]);
      await tx.insert(s.messages).values({
        organizationId: orgA.id, senderId: memberA.id, clientId: randomUUID(),
        subject: "Scoped message", body: "Test only", requestedRecipients: [memberA.id], recipientCount: 1,
      });
      assert.equal((await tx.select().from(s.messages)).length, 1);
    });
    await assert.rejects(scoped(db, context, (tx) =>
      tx.update(s.members).set({ status: "disabled" }).where(eq(s.members.id, memberA.id))), denied);
    await assert.rejects(scoped(db, context, (tx) => tx.insert(s.messages).values({
      organizationId: orgB.id, senderId: memberB.id, clientId: randomUUID(),
      subject: "Cross tenant message", body: "Test only", requestedRecipients: [memberB.id], recipientCount: 1,
    })), denied);
    await scoped(db, { authId: authB, organizationId: orgB.id, mailbox: true }, async (tx) => {
      assert.equal((await tx.select().from(s.messages)).length, 0);
    });
    await assertOutsideContextCleared();
  });

  await t.test("rollback clears the role, tenant and platform flag without committing writes", async () => {
    const abort = new Error("Deliberate transaction rollback");
    await assert.rejects(scoped(db, { authId: authA, organizationId: orgA.id, platform: true }, async (tx) => {
      await tx.insert(s.jobs).values({
        organizationId: orgB.id, title: "Rolled back job", company: "Example",
        description: "Must not persist", url: "https://example.test/job",
      });
      throw abort;
    }), (error) => error === abort);
    await assertOutsideContextCleared();
    await scoped(db, { organizationId: orgB.id }, async (tx) => {
      assert.deepEqual((await tx.select().from(s.organizations)).map((row) => row.id), [orgB.id]);
      assert.equal((await tx.select().from(s.jobs)).length, 0);
    });
    await assertOutsideContextCleared();
  });
});
