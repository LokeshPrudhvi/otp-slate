import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { connectDatabase, migrateDatabase } from "./database.js";
import { deliverOne, type MailTransport } from "./mail-worker.js";
import {
  decryptPayload,
  encryptPayload,
  formatWelcomeMail,
  MailQuotaError,
  sendResetMail,
  sendWelcomeMail,
  type WelcomeMailPayload,
} from "./providers.js";
import { outbox } from "./schema.js";

const secret = "mail-worker-test-only-secret-at-least-32-characters";
const welcome: WelcomeMailPayload = {
  email: "learner@example.test",
  name: "Test Learner",
  temporaryPassword: "Test-only-welcome-password!2026",
  loginUrl: "https://learn.example.test/login",
  organizationName: "Test Academy",
  studentId: "STUDENT-001",
};
const reset = {
  email: "learner@example.test",
  url: "https://learn.example.test/reset-password?token=test-only",
};
const noSend: MailTransport = {
  async password_reset() {
    assert.fail("Unexpected reset mail send.");
  },
  async welcome_student() {
    assert.fail("Unexpected welcome mail send.");
  },
};

test("Resend quota responses become safe deferred errors without exposing provider details", async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = "re_test_stub_never_sent_to_network";
  process.env.EMAIL_FROM = "OTP Slate <noreply@example.test>";
  let quota = "daily_quota_exceeded";
  let responseStatus = 429;
  let responseBody: unknown;
  let calls = 0;
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init.method, "POST");
    assert.ok(new Headers(init.headers).get("Idempotency-Key"));
    assert.ok(init.signal);
    return new Response(
      JSON.stringify(
        responseBody ?? {
          name: quota,
          message: `Provider details ${welcome.email} ${welcome.temporaryPassword}`,
        },
      ),
      {
        status: responseStatus,
        headers: { "Content-Type": "application/json" },
      },
    );
  });
  try {
    for (const type of ["daily", "monthly"] as const) {
      quota = `${type}_quota_exceeded`;
      for (const operation of [
        () => sendResetMail("reset-test-id", reset),
        () => sendWelcomeMail("welcome-test-id", welcome),
      ]) {
        await assert.rejects(operation, (error) => {
          assert.ok(error instanceof MailQuotaError);
          assert.equal(error.quota, type);
          assert.equal(error.retryAfterMs, 24 * 3600_000);
          assert.ok(!error.message.includes(welcome.email));
          assert.ok(!error.message.includes(welcome.temporaryPassword));
          return true;
        });
      }
    }
    assert.equal(calls, 4);
    responseStatus = 200;
    responseBody = { id: "provider-accepted-test-id" };
    await sendWelcomeMail("welcome-test-id", welcome);
    responseBody = {};
    await assert.rejects(
      () => sendWelcomeMail("welcome-test-id", welcome),
      /acceptance was not confirmed/,
    );
    assert.deepEqual(logs, []);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.EMAIL_FROM;
    else process.env.EMAIL_FROM = previousFrom;
  }
});

test("welcome payloads are encrypted, validated by type, and escaped in HTML", () => {
  const encrypted = encryptPayload(secret, welcome);
  assert.ok(!encrypted.includes(welcome.email));
  assert.ok(!encrypted.includes(welcome.temporaryPassword));
  assert.deepEqual(
    decryptPayload(secret, encrypted, "welcome_student"),
    welcome,
  );
  assert.deepEqual(
    decryptPayload(secret, encryptPayload(secret, reset)),
    reset,
  );
  assert.throws(
    () => decryptPayload(secret, encrypted),
    /Email payload is invalid/,
  );
  assert.throws(
    () => decryptPayload("incorrect-secret", encrypted, "welcome_student"),
    /Email payload could not be decrypted/,
  );
  assert.throws(
    () =>
      decryptPayload(
        secret,
        encryptPayload(secret, { ...welcome, loginUrl: "javascript:alert(1)" }),
        "welcome_student",
      ),
    /Email payload is invalid/,
  );
  assert.throws(
    () =>
      decryptPayload(
        secret,
        encryptPayload(secret, { ...welcome, temporaryPassword: null }),
        "welcome_student",
      ),
    /Email payload is invalid/,
  );
  const message = formatWelcomeMail({
    ...welcome,
    name: '<script>alert("hello")</script>',
    temporaryPassword: `test<&>"'password`,
    organizationName: "Learning <b>Lab</b>",
    studentId: 'STUDENT<&"1',
    loginUrl: "https://learn.example.test/login?a=1&b=2",
  });
  assert.match(message.text, /Temporary password: test<&>"'password/);
  assert.match(
    message.html,
    /&lt;script&gt;alert\(&quot;hello&quot;\)&lt;\/script&gt;/,
  );
  assert.match(message.html, /test&lt;&amp;&gt;&quot;&#39;password/);
  assert.match(message.html, /Learning &lt;b&gt;Lab&lt;\/b&gt;/);
  assert.match(message.html, /STUDENT&lt;&amp;&quot;1/);
  assert.match(
    message.html,
    /href="https:\/\/learn.example.test\/login\?a=1&amp;b=2"/,
  );
  assert.ok(!message.html.includes("<script>"));
});

test("mail worker preserves acceptance, retry, expiry, and lease boundaries", async (t) => {
  // Every test uses embedded, in-memory PostgreSQL and an injected sender.
  // No service is started and no email provider is contacted.
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const db = connection.db;
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  t.after(async () => connection.close());
  t.beforeEach(async () => {
    await db.delete(outbox);
    warnings.length = 0;
  });
  const queued = (overrides: Partial<typeof outbox.$inferInsert> = {}) => ({
    type: "welcome_student",
    encryptedPayload: encryptPayload(secret, welcome),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    ...overrides,
  });
  async function read(id: string) {
    const [job] = await db.select().from(outbox).where(eq(outbox.id, id));
    assert.ok(job);
    return job;
  }

  await t.test(
    "dispatches reset and welcome separately and clears accepted payloads",
    async () => {
      const jobs = await db
        .insert(outbox)
        .values([
          queued(),
          queued({
            type: "password_reset",
            encryptedPayload: encryptPayload(secret, reset),
          }),
        ])
        .returning();
      const calls: { id: string; type: string; payload: unknown }[] = [];
      const sender: MailTransport = {
        async password_reset(id, payload) {
          calls.push({ id, type: "password_reset", payload });
        },
        async welcome_student(id, payload) {
          calls.push({ id, type: "welcome_student", payload });
        },
      };
      await deliverOne(db, secret, sender);
      await deliverOne(db, secret, sender);
      assert.equal(calls.length, 2);
      assert.deepEqual(
        calls.find(({ type }) => type === "welcome_student")?.payload,
        welcome,
      );
      assert.deepEqual(
        calls.find(({ type }) => type === "password_reset")?.payload,
        reset,
      );
      for (const job of jobs) {
        const state = await read(job.id);
        assert.equal(state.status, "accepted");
        assert.equal(state.encryptedPayload, "");
        assert.equal(state.attempts, 1);
        assert.ok(calls.some(({ id }) => id === job.id));
      }
      await deliverOne(db, secret, noSend);
    },
  );

  await t.test(
    "limits failures to five attempts and keeps credentials encrypted for retry",
    async () => {
      const [job] = await db.insert(outbox).values(queued()).returning();
      const ids: string[] = [];
      const sender: MailTransport = {
        ...noSend,
        async welcome_student(id) {
          ids.push(id);
          throw new Error(
            `Provider error containing ${welcome.temporaryPassword}`,
          );
        },
      };
      for (let attempt = 1; attempt <= 5; attempt++) {
        const before = Date.now();
        await deliverOne(db, secret, sender);
        const state = await read(job.id);
        assert.equal(state.attempts, attempt);
        assert.equal(state.status, attempt === 5 ? "failed" : "pending");
        assert.equal(state.encryptedPayload, job.encryptedPayload);
        const delay = Math.min(300_000, 30_000 * 2 ** (attempt - 1));
        assert.ok(state.availableAt.getTime() >= before + delay);
        await db
          .update(outbox)
          .set({ availableAt: new Date(Date.now() - 1000) })
          .where(eq(outbox.id, job.id));
      }
      await deliverOne(db, secret, noSend);
      assert.deepEqual(ids, Array(5).fill(job.id));
      assert.ok(!JSON.stringify(warnings).includes(welcome.temporaryPassword));
      assert.ok(!JSON.stringify(warnings).includes(welcome.email));
    },
  );

  await t.test(
    "quota refusal preserves the retry budget and retries once eligible without repeating acceptance",
    async () => {
      const [job] = await db
        .insert(outbox)
        .values(queued({ attempts: 4 }))
        .returning();
      const before = Date.now();
      let quotaCalls = 0;
      await deliverOne(db, secret, {
        ...noSend,
        async welcome_student() {
          quotaCalls++;
          throw new MailQuotaError("daily");
        },
      });
      const deferred = await read(job.id);
      assert.equal(quotaCalls, 1);
      assert.equal(deferred.status, "pending");
      assert.equal(deferred.attempts, 4);
      assert.equal(deferred.encryptedPayload, job.encryptedPayload);
      assert.ok(deferred.availableAt.getTime() >= before + 24 * 3600_000);
      await deliverOne(db, secret, noSend);
      await db
        .update(outbox)
        .set({ availableAt: new Date(Date.now() - 1000) })
        .where(eq(outbox.id, job.id));
      let acceptedCalls = 0;
      await deliverOne(db, secret, {
        ...noSend,
        async welcome_student(id) {
          assert.equal(id, job.id);
          acceptedCalls++;
        },
      });
      assert.equal((await read(job.id)).status, "accepted");
      assert.equal((await read(job.id)).encryptedPayload, "");
      await deliverOne(db, secret, noSend);
      assert.equal(acceptedCalls, 1);
    },
  );

  await t.test(
    "cleans expired pending, processing, and failed jobs while mail is unconfigured",
    async () => {
      const expired = await db
        .insert(outbox)
        .values(
          ["pending", "processing", "failed"].map((status) =>
            queued({
              status,
              expiresAt: new Date(Date.now() - 1000),
              availableAt: new Date(Date.now() + 60_000),
            }),
          ),
        )
        .returning();
      const [pending, failed] = await db
        .insert(outbox)
        .values([queued(), queued({ status: "failed", attempts: 5 })])
        .returning();
      const oldKey = process.env.RESEND_API_KEY;
      const oldFrom = process.env.EMAIL_FROM;
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
      try {
        await deliverOne(db, secret);
      } finally {
        if (oldKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = oldKey;
        if (oldFrom === undefined) delete process.env.EMAIL_FROM;
        else process.env.EMAIL_FROM = oldFrom;
      }
      for (const job of expired) {
        const state = await read(job.id);
        assert.equal(state.status, "expired");
        assert.equal(state.encryptedPayload, "");
        assert.equal(state.attempts, 0);
      }
      assert.deepEqual(await read(pending.id), pending);
      assert.deepEqual(await read(failed.id), failed);
    },
  );

  await t.test("bounds expiry cleanup to 100 jobs per pass", async () => {
    await db.insert(outbox).values(
      Array.from({ length: 101 }, () =>
        queued({
          expiresAt: new Date(Date.now() - 1000),
        }),
      ),
    );
    await deliverOne(db, secret, noSend);
    let states = await db.select().from(outbox);
    assert.equal(
      states.filter(({ status }) => status === "expired").length,
      100,
    );
    await deliverOne(db, secret, noSend);
    states = await db.select().from(outbox);
    assert.ok(
      states.every(
        ({ status, encryptedPayload }) =>
          status === "expired" && !encryptedPayload,
      ),
    );
  });

  await t.test(
    "does not send active leases or reclaim a sixth attempt",
    async () => {
      const [leased, exhausted] = await db
        .insert(outbox)
        .values([
          queued({
            status: "processing",
            attempts: 1,
            availableAt: new Date(Date.now() + 60_000),
          }),
          queued({
            status: "processing",
            attempts: 5,
            availableAt: new Date(Date.now() - 1000),
          }),
        ])
        .returning();
      await deliverOne(db, secret, noSend);
      assert.deepEqual(await read(leased.id), leased);
      const state = await read(exhausted.id);
      assert.equal(state.status, "failed");
      assert.equal(state.attempts, 5);
      assert.equal(state.encryptedPayload, exhausted.encryptedPayload);
    },
  );

  for (const oldAttemptFails of [false, true]) {
    await t.test(
      `stale ${oldAttemptFails ? "failure" : "acceptance"} cannot overwrite a reclaimed lease`,
      async () => {
        const [job] = await db.insert(outbox).values(queued()).returning();
        let started!: () => void;
        let release!: () => void;
        const began = new Promise<void>((resolve) => {
          started = resolve;
        });
        const paused = new Promise<void>((resolve) => {
          release = resolve;
        });
        const oldAttempt = deliverOne(db, secret, {
          ...noSend,
          async welcome_student() {
            started();
            await paused;
            if (oldAttemptFails) throw new Error("Old attempt failed.");
          },
        });
        await began;
        await db
          .update(outbox)
          .set({ availableAt: new Date(Date.now() - 1000) })
          .where(eq(outbox.id, job.id));
        await deliverOne(db, secret, {
          ...noSend,
          async welcome_student(id) {
            assert.equal(id, job.id);
            if (!oldAttemptFails) throw new Error("New attempt failed.");
          },
        });
        const newState = await read(job.id);
        assert.equal(newState.status, oldAttemptFails ? "accepted" : "pending");
        assert.equal(newState.attempts, 2);
        release();
        await oldAttempt;
        assert.deepEqual(await read(job.id), newState);
      },
    );
  }
});
