import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
import { eq, like } from "drizzle-orm";
import { Pool } from "pg";
import { createAuthRateLimitStorage } from "./auth-rate-limit.js";
import { createAuth } from "./auth.js";
import type { Database } from "./database.js";
import { migration } from "./migration.js";
import * as s from "./schema.js";

test("database auth limits stay atomic, durable and use one round trip for allowed requests", async (t) => {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(migration);
  t.after(() => client.close());
  const statements: string[] = [];
  const db = drizzle(client, {
    schema: s,
    logger: {
      logQuery(query) {
        statements.push(query);
      },
    },
  });

  await t.test(
    "window slides only for accepted requests and resets at its exact boundary",
    async () => {
      let timestamp = 100_000;
      const storage = createAuthRateLimitStorage(db, { now: () => timestamp });
      const rule = { window: 10, max: 3 };
      for (let attempt = 0; attempt < 3; attempt++) {
        statements.length = 0;
        assert.deepEqual(await storage.consume("rolling", rule), {
          allowed: true,
          retryAfter: null,
        });
        assert.equal(statements.length, 1);
        timestamp += 1000;
      }
      assert.deepEqual(await storage.consume("rolling", rule), {
        allowed: false,
        retryAfter: 9,
      });
      timestamp = 111_999;
      assert.deepEqual(await storage.consume("rolling", rule), {
        allowed: false,
        retryAfter: 1,
      });
      const [rejected] = await db
        .select()
        .from(s.rateLimit)
        .where(eq(s.rateLimit.key, "rolling"));
      assert.equal(rejected.count, 3);
      assert.equal(rejected.lastRequest, 102_000);
      timestamp = 112_000;
      assert.deepEqual(await storage.consume("rolling", rule), {
        allowed: true,
        retryAfter: null,
      });
      const [reset] = await db
        .select()
        .from(s.rateLimit)
        .where(eq(s.rateLimit.key, "rolling"));
      assert.equal(reset.count, 1);
      assert.equal(reset.lastRequest, timestamp);
    },
  );

  await t.test(
    "simultaneous requests from independent instances share one durable limit",
    async () => {
      const options = { now: () => 200_000 };
      const first = createAuthRateLimitStorage(db, options);
      const second = createAuthRateLimitStorage(db, options);
      const rule = { window: 60, max: 7 };
      const results = await Promise.all(
        Array.from({ length: 40 }, (_, index) =>
          (index % 2 ? first : second).consume("concurrent", rule),
        ),
      );
      assert.equal(results.filter((item) => item.allowed).length, 7);
      assert.ok(
        results
          .filter((item) => !item.allowed)
          .every((item) => item.retryAfter === 60),
      );
      const restarted = createAuthRateLimitStorage(db, options);
      assert.deepEqual(await restarted.consume("concurrent", rule), {
        allowed: false,
        retryAfter: 60,
      });
      const [stored] = await db
        .select()
        .from(s.rateLimit)
        .where(eq(s.rateLimit.key, "concurrent"));
      assert.equal(stored.count, 7);
      assert.deepEqual(await restarted.consume("independent-key", rule), {
        allowed: true,
        retryAfter: null,
      });
    },
  );

  await t.test(
    "cleanup is bounded, preserves active buckets, and adds no request round trip",
    async () => {
      let timestamp = 3 * 24 * 3600_000;
      const storage = createAuthRateLimitStorage(db, { now: () => timestamp });
      await db.insert(s.rateLimit).values([
        ...Array.from({ length: 105 }, (_, index) => ({
          id: randomUUID(),
          key: `expired-${index}`,
          count: 2,
          lastRequest: timestamp - 2 * 24 * 3600_000,
        })),
        {
          id: randomUUID(),
          key: "still-active",
          count: 3,
          lastRequest: timestamp + 59_000,
        },
      ]);
      timestamp += 60_000;
      statements.length = 0;
      assert.equal(
        (await storage.consume("cleanup-trigger", { window: 60, max: 60 }))
          .allowed,
        true,
      );
      assert.equal(statements.length, 1);
      // Earlier subtests left three other expired buckets; at most 100 total are deleted.
      const oldRows = await db
        .select()
        .from(s.rateLimit)
        .where(like(s.rateLimit.key, "expired-%"));
      assert.ok(oldRows.length >= 5 && oldRows.length <= 8);
      assert.deepEqual(
        await storage.consume("still-active", { window: 60, max: 3 }),
        {
          allowed: false,
          retryAfter: 59,
        },
      );
      const [active] = await db
        .select()
        .from(s.rateLimit)
        .where(eq(s.rateLimit.key, "still-active"));
      assert.equal(active.count, 3);
      assert.equal(active.lastRequest, timestamp - 1000);
      await assert.rejects(
        storage.consume("invalid-rule", { window: 3600, max: 3 }),
        /Unsupported/,
      );
    },
  );

  await t.test(
    "a cleanup-due request still rejects a full bucket without extending its window",
    async () => {
      let timestamp = 5 * 24 * 3600_000;
      const storage = createAuthRateLimitStorage(db, { now: () => timestamp });
      await db.insert(s.rateLimit).values({
        id: randomUUID(),
        key: "cleanup-blocked",
        count: 3,
        lastRequest: timestamp + 59_000,
      });
      timestamp += 60_000;
      statements.length = 0;
      assert.deepEqual(
        await storage.consume("cleanup-blocked", { window: 60, max: 3 }),
        {
          allowed: false,
          retryAfter: 59,
        },
      );
      assert.equal(
        statements.length,
        2,
        "a blocked UPSERT returns no rows and then reads retryAfter",
      );
      const [row] = await db
        .select()
        .from(s.rateLimit)
        .where(eq(s.rateLimit.key, "cleanup-blocked"));
      assert.equal(row.count, 3);
      assert.equal(row.lastRequest, timestamp - 1000);
    },
  );

  await t.test(
    "Better Auth keeps strict sign-in and MFA rules through its HTTP handler",
    async () => {
      const auth = createAuth(
        db,
        {
          production: false,
          databaseUrl: "pglite://memory",
          migrationUrl: undefined,
          secret: "auth-rate-limit-test-only-at-least-32-character-secret",
          authUrl: "http://localhost:3000",
          origins: ["http://localhost:5173"],
          port: 3000,
        },
        false,
      );
      const send = (path: string, body: unknown) =>
        auth.handler(
          new Request(`http://localhost:3000/api/auth${path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: "http://localhost:5173",
            },
            body: JSON.stringify(body),
          }),
        );
      for (let index = 0; index < 3; index++) {
        assert.equal(
          (
            await send("/sign-in/email", {
              email: "unknown-auth-limit@example.test",
              password: "not-a-real-password",
            })
          ).status,
          401,
        );
      }
      const blocked = await send("/sign-in/email", {
        email: "unknown-auth-limit@example.test",
        password: "not-a-real-password",
      });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("x-retry-after")) > 0);
      for (let index = 0; index < 3; index++) {
        assert.notEqual(
          (await send("/two-factor/verify-totp", { code: "000000" })).status,
          429,
        );
      }
      assert.equal(
        (await send("/two-factor/verify-totp", { code: "000000" })).status,
        429,
      );
    },
  );
});

// This locking regression needs two PostgreSQL connections; PGlite serializes
// statements internally. Opt in only with an explicitly isolated test database.
const postgresTestUrl = process.env.SLATE_RATE_LIMIT_TEST_DATABASE_URL;
test(
  "concurrent PostgreSQL cleanup skips another request's locked bucket",
  {
    skip: !postgresTestUrl,
  },
  async () => {
    assert.equal(process.env.SLATE_RATE_LIMIT_TEST_ISOLATED, "1");
    const pool = new Pool({ connectionString: postgresTestUrl, max: 3 });
    const schema = `auth_limit_test_${randomUUID().replaceAll("-", "")}`;
    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      // A private test schema keeps fixtures and pruning away from app buckets.
      await pool.query(`create schema ${schema}`);
      await pool.query(`create table ${schema}.auth_rate_limit (
      id text primary key, key text not null unique,
      count integer not null, last_request bigint not null
    )`);
      let timestamp = Date.now();
      const expired = timestamp - 2 * 24 * 3600_000;
      await pool.query(
        `insert into ${schema}.auth_rate_limit values
      ('test-a', 'test-a', 3, $1), ('test-b', 'test-b', 3, $1)`,
        [expired],
      );
      for (let index = 0; index < clients.length; index++) {
        await clients[index].query("begin");
        await clients[index].query(`set local search_path to ${schema}`);
        await clients[index].query("set local statement_timeout to '5s'");
        // Force overlapping ownership. Cleanup must never wait on the other row.
        await clients[index].query(
          "select id from auth_rate_limit where key=$1 for update",
          [index ? "test-b" : "test-a"],
        );
      }
      const stores = clients.map((client) =>
        createAuthRateLimitStorage(
          postgresDrizzle(client, { schema: s }) as unknown as Database,
          { now: () => timestamp },
        ),
      );
      timestamp += 60_000;
      const outcomes = await Promise.all(
        stores.map((storage, index) =>
          storage.consume(index ? "test-b" : "test-a", { window: 10, max: 3 }),
        ),
      );
      assert.ok(outcomes.every((outcome) => outcome.allowed));
      await Promise.all(clients.map((client) => client.query("commit")));
      const result = await pool.query(
        `select key, count, last_request from ${schema}.auth_rate_limit order by key`,
      );
      assert.deepEqual(
        result.rows.map((row) => ({
          ...row,
          last_request: Number(row.last_request),
        })),
        [
          { key: "test-a", count: 1, last_request: timestamp },
          { key: "test-b", count: 1, last_request: timestamp },
        ],
      );
    } finally {
      await Promise.allSettled(
        clients.map((client) => client.query("rollback")),
      );
      clients.forEach((client) => client.release());
      await pool.query(`drop schema if exists ${schema} cascade`);
      await pool.end();
    }
  },
);
