import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase } from "./database.js";
import { deliverOne, type MailTransport } from "./mail-worker.js";
import { decryptPayload } from "./providers.js";
import * as s from "./schema.js";

test("student email corrections prevent stale password-reset delivery", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  t.after(() => connection.close());
  const db = connection.db;
  const config = {
    production: false, databaseUrl: "pglite://memory", migrationUrl: undefined,
    secret: "profile-mail-test-only-secret-at-least-32-characters",
    authUrl: "http://localhost:3000", origins: ["http://localhost:5173"], port: 0,
  };
  const auth = createAuth(db, config, true);
  const identity = await auth.api.createUser({ body: {
    name: "Mail test student", email: "old@example.test", password: "Mail-test-only-password!2026", role: "user",
  } });
  const noSend: MailTransport = {
    async password_reset() { assert.fail("A stale reset must not be delivered."); },
    async welcome_student() { assert.fail("No welcome message belongs to this test."); },
  };
  const request = (email: string) => auth.api.requestPasswordReset({ body: {
    email, redirectTo: "http://localhost:5173/reset-password",
  } });
  async function takeJob() {
    const [job] = await db.select().from(s.outbox);
    assert.ok(job);
    return job;
  }
  t.beforeEach(() => db.delete(s.outbox));

  await t.test("an email edit between identity lookup and enqueue revokes the new stale token", async () => {
    const token = "stale-lookup-test-token";
    await db.insert(s.verification).values({
      id: randomUUID(), identifier: `reset-password:${token}`, value: identity.user.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await db.update(s.user).set({ email: "corrected@example.test" }).where(eq(s.user.id, identity.user.id));
    await auth.options.emailAndPassword.sendResetPassword({
      user: identity.user, token, url: `http://localhost:3000/api/auth/reset-password/${token}`,
    });
    assert.deepEqual(await db.select().from(s.outbox), []);
    assert.deepEqual(await db.select().from(s.verification).where(eq(s.verification.identifier, `reset-password:${token}`)), []);
  });

  await t.test("a valid reset carries its identity and reaches the injected sender", async () => {
    await request("corrected@example.test");
    const job = await takeJob();
    const payload = decryptPayload(config.secret, job.encryptedPayload);
    assert.equal(payload.userId, identity.user.id);
    let sends = 0;
    await deliverOne(db, config.secret, { ...noSend, async password_reset(id, message) {
      assert.equal(id, job.id);
      assert.equal(message.email, "corrected@example.test");
      sends++;
    } });
    assert.equal(sends, 1);
    assert.equal((await takeJob()).status, "accepted");
  });

  await t.test("a queued reset for the previous login address expires without sending", async () => {
    await request("corrected@example.test");
    await db.update(s.user).set({ email: "final@example.test" }).where(eq(s.user.id, identity.user.id));
    await deliverOne(db, config.secret, noSend);
    assert.equal((await takeJob()).status, "expired");
    assert.equal((await takeJob()).encryptedPayload, "");
  });

  await t.test("a revoked reset token is not sent even when the email still matches", async () => {
    await request("final@example.test");
    await db.delete(s.verification).where(eq(s.verification.value, identity.user.id));
    await deliverOne(db, config.secret, noSend);
    assert.equal((await takeJob()).status, "expired");
  });
});
