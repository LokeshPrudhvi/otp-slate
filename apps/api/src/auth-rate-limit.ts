import { randomUUID } from "node:crypto";
import type { BetterAuthRateLimitStorage } from "better-auth";
import { eq, sql } from "drizzle-orm";
import type { Database } from "./database.js";
import { rateLimit } from "./schema.js";

// Includes the global/reset-password window (60s), sign-in (10s), and MFA (10s).
// Increase this together with any future rule that has a longer window.
export const authRateLimitMaxWindowSeconds = 60;

export function createAuthRateLimitStorage(
  db: Database,
  options: { maxWindowSeconds?: number; now?: () => number } = {},
): BetterAuthRateLimitStorage {
  const now = options.now ?? Date.now;
  const maxWindowSeconds =
    options.maxWindowSeconds ?? authRateLimitMaxWindowSeconds;
  if (!Number.isFinite(maxWindowSeconds) || maxWindowSeconds <= 0)
    throw new Error("Invalid maximum authentication rate-limit window.");
  const retentionMs = Math.max(24 * 3600_000, maxWindowSeconds * 1000);
  let nextCleanupAt = now() + 60_000;

  return {
    async consume(key, rule) {
      if (
        !Number.isFinite(rule.window) ||
        rule.window <= 0 ||
        rule.window > maxWindowSeconds ||
        !Number.isSafeInteger(rule.max) ||
        rule.max < 1
      )
        throw new Error("Unsupported authentication rate-limit rule.");

      for (;;) {
        const timestamp = now();
        const cutoff = timestamp - rule.window * 1000;
        const consume = sql`
          insert into ${rateLimit} (id, key, count, last_request)
          values (${randomUUID()}, ${key}, 1, ${timestamp})
          on conflict (key) do update set
            count = case when ${rateLimit.lastRequest} <= ${cutoff}
              then 1 else ${rateLimit.count} + 1 end,
            last_request = ${timestamp}
          where ${rateLimit.lastRequest} <= ${cutoff}
            or ${rateLimit.count} < ${rule.max}
          returning ${rateLimit.lastRequest}
        `;
        let statement = consume;
        if (timestamp >= nextCleanupAt) {
          nextCleanupAt = timestamp + 60_000;
          // Finish the current bucket's UPSERT before cleanup locks any rows.
          // SKIP LOCKED then avoids another instance's current bucket or cleanup
          // work. Without both steps, two requests can lock each other's bucket.
          // The CTEs share one round trip; no background promise can outlive db.
          const expiredBefore = timestamp - retentionMs;
          statement = sql`with consumed as (${consume}), expired_buckets as (
            select ${rateLimit.id} from ${rateLimit}
            where exists (select 1 from consumed)
              and ${rateLimit.lastRequest} < ${expiredBefore}
              and ${rateLimit.key} <> ${key}
            limit 100 for update skip locked
          ), pruned_buckets as (
            delete from ${rateLimit}
            where ${rateLimit.id} in (select id from expired_buckets)
              and ${rateLimit.lastRequest} < ${expiredBefore}
              and ${rateLimit.key} <> ${key}
            returning ${rateLimit.id}
          ) select * from consumed`;
        }
        const result = await db.execute(statement);
        if (result.rows.length) return { allowed: true, retryAfter: null };

        // Only rejected requests need another read. No update means a rejected
        // attempt cannot extend the inactivity window or increment its count.
        const [current] = await db
          .select({
            lastRequest: rateLimit.lastRequest,
            count: rateLimit.count,
          })
          .from(rateLimit)
          .where(eq(rateLimit.key, key));
        const checkedAt = now();
        if (
          !current ||
          checkedAt - current.lastRequest >= rule.window * 1000 ||
          current.count < rule.max
        )
          continue;
        return {
          allowed: false,
          retryAfter: Math.ceil(
            (current.lastRequest + rule.window * 1000 - checkedAt) / 1000,
          ),
        };
      }
    },
  };
}
