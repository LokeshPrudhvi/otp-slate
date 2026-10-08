import { and, eq, gt, lte, or } from "drizzle-orm";
import { outbox } from "./schema.js";
import type { Database } from "./database.js";
import { decryptPayload, sendResetMail } from "./providers.js";

export async function deliverOne(db: Database, secret: string) {
  const job = await db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(outbox)
      .where(
        and(
          or(eq(outbox.status, "pending"), eq(outbox.status, "processing")),
          lte(outbox.availableAt, new Date()),
          gt(outbox.expiresAt, new Date()),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    if (!pending) return null;
    await tx
      .update(outbox)
      .set({
        status: "processing",
        attempts: pending.attempts + 1,
        availableAt: new Date(Date.now() + 60_000),
      })
      .where(eq(outbox.id, pending.id));
    return pending;
  });
  if (!job) return;
  try {
    await sendResetMail(job.id, decryptPayload(secret, job.encryptedPayload));
    await db
      .update(outbox)
      .set({ status: "sent", encryptedPayload: "" })
      .where(eq(outbox.id, job.id));
  } catch {
    await db
      .update(outbox)
      .set({
        status: job.attempts >= 4 ? "failed" : "pending",
        availableAt: new Date(
          Date.now() + Math.min(300_000, 30_000 * 2 ** job.attempts),
        ),
      })
      .where(eq(outbox.id, job.id));
    console.warn(
      "A password-reset email is awaiting retry or operator review.",
    );
  }
}
export function startMailWorker(db: Database, secret: string) {
  let running = false;
  const timer = setInterval(async () => {
    if (running || !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      return;
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
