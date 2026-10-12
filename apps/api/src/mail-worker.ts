import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { outbox, user, verification } from "./schema.js";
import type { Database } from "./database.js";
import {
  decryptPayload,
  emailConfigured,
  MailQuotaError,
  sendResetMail,
  sendWelcomeMail,
  type MailPayloads,
} from "./providers.js";

export type MailTransport = {
  [T in keyof MailPayloads]: (
    id: string,
    payload: MailPayloads[T],
  ) => Promise<void>;
};
const providerTransport: MailTransport = {
  password_reset: sendResetMail,
  welcome_student: sendWelcomeMail,
};
const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
const EXPIRY_BATCH_SIZE = 100;

export async function deliverOne(
  db: Database,
  secret: string,
  transport?: MailTransport,
) {
  const sender =
    transport ?? (emailConfigured() ? providerTransport : undefined);
  const job = await db.transaction(async (tx) => {
    const now = new Date();
    const expired = await tx
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          inArray(outbox.status, ["pending", "processing", "failed"]),
          lte(outbox.expiresAt, now),
        ),
      )
      .orderBy(asc(outbox.expiresAt))
      .for("update", { skipLocked: true })
      .limit(EXPIRY_BATCH_SIZE);
    if (expired.length) {
      await tx
        .update(outbox)
        .set({ status: "expired", encryptedPayload: "" })
        .where(
          inArray(
            outbox.id,
            expired.map(({ id }) => id),
          ),
        );
    }
    // Expiry cleanup remains active when mail is not configured. Pending work
    // keeps its attempts and schedule until a real or injected sender is ready.
    if (!sender) return null;
    const [pending] = await tx
      .select()
      .from(outbox)
      .where(
        and(
          or(eq(outbox.status, "pending"), eq(outbox.status, "processing")),
          lte(outbox.availableAt, now),
          gt(outbox.expiresAt, now),
        ),
      )
      .orderBy(asc(outbox.availableAt), asc(outbox.createdAt))
      .for("update", { skipLocked: true })
      .limit(1);
    if (!pending) return null;
    if (pending.attempts >= MAX_ATTEMPTS) {
      await tx
        .update(outbox)
        .set({ status: "failed" })
        .where(eq(outbox.id, pending.id));
      return null;
    }
    const lease = {
      attempts: pending.attempts + 1,
      availableAt: new Date(Date.now() + LEASE_MS),
    };
    await tx
      .update(outbox)
      .set({
        status: "processing",
        ...lease,
      })
      .where(eq(outbox.id, pending.id));
    return { ...pending, ...lease };
  });
  if (!job || !sender) return;
  // A reclaimed lease or administrator retry must not be overwritten by a
  // slower attempt. Resend receives the same idempotency key on every attempt.
  const currentLease = and(
    eq(outbox.id, job.id),
    eq(outbox.status, "processing"),
    eq(outbox.attempts, job.attempts),
    eq(outbox.availableAt, job.availableAt),
  );
  try {
    if (job.type === "password_reset") {
      const payload = decryptPayload(secret, job.encryptedPayload, "password_reset");
      if (payload.userId) {
        const token = new URL(payload.url).pathname.split("/").pop();
        const [current] = await db.select({ id: user.id })
          .from(user).innerJoin(verification, and(
            eq(verification.value, user.id),
            eq(verification.identifier, `reset-password:${token}`),
            gt(verification.expiresAt, new Date()),
          )).where(and(eq(user.id, payload.userId), eq(user.email, payload.email)));
        // Email correction revokes old reset tokens. Do not send a queued
        // reset to a previous address or deliver an already-consumed link.
        if (!current) {
          await db.update(outbox).set({ status: "expired", encryptedPayload: "" }).where(currentLease);
          return;
        }
      }
      await sender.password_reset(job.id, payload);
    } else if (job.type === "welcome_student") {
      const payload = decryptPayload(secret, job.encryptedPayload, "welcome_student");
      if (payload.userId) {
        const [current] = await db.select({ id: user.id }).from(user)
          .where(and(eq(user.id, payload.userId), eq(user.email, payload.email)));
        // Older members may predate registration records. Their corrected
        // welcome jobs still must not be delivered to a superseded address.
        if (!current) {
          await db.update(outbox).set({ status: "expired", encryptedPayload: "" }).where(currentLease);
          return;
        }
      }
      await sender.welcome_student(job.id, payload);
    } else {
      throw new Error("Unsupported email type.");
    }
    await db
      .update(outbox)
      .set({ status: "accepted", encryptedPayload: "" })
      .where(currentLease);
  } catch (error) {
    const expired = job.expiresAt.getTime() <= Date.now();
    const quotaLimited = error instanceof MailQuotaError;
    await db
      .update(outbox)
      .set({
        status: expired
          ? "expired"
          : !quotaLimited && job.attempts >= MAX_ATTEMPTS
            ? "failed"
            : "pending",
        ...(expired ? { encryptedPayload: "" } : {}),
        // Quota refusal did not accept a message. Preserve the failure budget
        // and retry the same job/idempotency key after the daily cooldown.
        ...(quotaLimited ? { attempts: Math.max(0, job.attempts - 1) } : {}),
        availableAt: new Date(
          Date.now() +
            (quotaLimited
              ? error.retryAfterMs
              : Math.min(300_000, 30_000 * 2 ** (job.attempts - 1))),
        ),
      })
      .where(currentLease);
    if (!expired)
      console.warn(
        quotaLimited
          ? "Email sending quota reached; queued mail will retry after the cooldown."
          : "An email is awaiting retry or operator review.",
      );
  }
}
export function startMailWorker(db: Database, secret: string) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await deliverOne(db, secret);
    } catch {
      console.warn("Email worker could not claim pending work.");
    } finally {
      running = false;
    }
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
