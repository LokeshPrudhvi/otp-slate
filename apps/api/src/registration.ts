import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createAuth } from "./auth.js";
import { hashPassword } from "better-auth/crypto";
import { type Database, type Transaction } from "./database.js";
import { encryptPayload, type WelcomeMailPayload } from "./providers.js";
import type { Actor, SlateService } from "./service.js";
import * as s from "./schema.js";
import {
  branchCodeInput,
  branchNameInput,
  requireOrganizationBranch,
} from "./branches.js";

const clean = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u001f\u007f]/.test(value),
      "Remove control characters.",
    );
export const registrationFields = {
  studentId: clean(80),
  name: clean(120),
  email: z
    .email()
    .max(200)
    .transform((value) => value.trim().toLowerCase()),
  phone: z
    .string()
    .trim()
    .transform((value) => {
      const compact = value.replace(/[\s()-]/g, "");
      return /^[6-9]\d{9}$/.test(compact) ? `+91${compact}` : compact;
    })
    .pipe(
      z
        .string()
        .regex(
          /^\+[1-9]\d{7,14}$/,
          "Use a mobile number with its country code, or a 10-digit Indian mobile number.",
        ),
    ),
  cohort: z
    .string()
    .trim()
    .max(120)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
    .optional(),
  branchName: branchNameInput,
  branchCode: branchCodeInput,
};
export const registrationInput = z
  .object({ organizationId: z.uuid(), ...registrationFields })
  .strict();
export const studentProfileInput = z
  .object({
    name: registrationFields.name,
    email: registrationFields.email,
    phone: registrationFields.phone,
    branchName: registrationFields.branchName,
    branchCode: registrationFields.branchCode,
  })
  .strict();
export type RegistrationInput = z.infer<typeof registrationInput>;
export const registrationRequests = pgTable("registration_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("org_id").notNull(),
  studentId: text("student_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  cohort: text("cohort"),
  branchName: text("branch_name").notNull(),
  branchCode: text("branch_code").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("pending"),
  memberId: uuid("member_id"),
  welcomeOutboxId: uuid("welcome_outbox_id"),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
const rateLimits = pgTable("registration_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
function duplicate(error: unknown) {
  const record = error as { code?: string; cause?: { code?: string } };
  return record?.code === "23505" || record?.cause?.code === "23505";
}
const duplicateMessage =
  "A registration or account with these details already exists. Contact your organization.";

export class RegistrationService {
  constructor(private readonly service: SlateService) {}
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException(
        "Only Platform Admin can review registrations.",
      );
  }
  private async publicScope<T>(
    organizationId: string | undefined,
    work: (tx: Transaction) => Promise<T>,
  ) {
    return this.service.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE slate_registration`);
      await tx.execute(
        sql`select set_config('slate.org_id', ${organizationId || ""}, true), set_config('slate.is_platform', 'false', true)`,
      );
      return work(tx);
    });
  }
  async organizations() {
    return this.publicScope(undefined, (tx) =>
      tx
        .select({ id: s.organizations.id, name: s.organizations.name })
        .from(s.organizations)
        .where(eq(s.organizations.status, "active"))
        .orderBy(s.organizations.name),
    );
  }
  async branches(organizationId: string) {
    return this.publicScope(organizationId, async (tx) => {
      const [organization] = await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(
          and(
            eq(s.organizations.id, organizationId),
            eq(s.organizations.status, "active"),
          ),
        );
      if (!organization)
        throw new BadRequestException("Choose an active organization.");
      return tx
        .select({
          organizationId: s.organizationBranches.organizationId,
          code: s.organizationBranches.code,
          name: s.organizationBranches.name,
        })
        .from(s.organizationBranches)
        .where(eq(s.organizationBranches.organizationId, organizationId))
        .orderBy(s.organizationBranches.name, s.organizationBranches.code);
    });
  }
  private async throttle(ip: string) {
    const hash = createHmac("sha256", this.service.config.secret)
      .update(ip)
      .digest("hex");
    const allowed = await this.publicScope(undefined, async (tx) => {
      const now = Date.now();
      await tx
        .delete(rateLimits)
        .where(lt(rateLimits.resetAt, new Date(now - 86400_000)));
      let permitted = true;
      for (const [window, maximum] of [
        [60_000, 5],
        [3600_000, 30],
      ]) {
        const key = `${hash}:${window}:${Math.floor(now / window)}`;
        const [row] = await tx
          .insert(rateLimits)
          .values({
            key,
            count: 1,
            resetAt: new Date((Math.floor(now / window) + 1) * window),
          })
          .onConflictDoUpdate({
            target: rateLimits.key,
            set: { count: sql`${rateLimits.count} + 1` },
          })
          .returning({ count: rateLimits.count });
        permitted &&= row.count <= maximum;
      }
      return permitted;
    });
    if (!allowed)
      throw new HttpException(
        "Too many registration requests. Please try again later.",
        429,
      );
  }
  private async ensureAvailable(
    tx: Transaction,
    input: RegistrationInput,
    organizationVerified = false,
  ) {
    const [org] = organizationVerified
      ? [{ id: input.organizationId }]
      : await tx
          .select({ id: s.organizations.id })
          .from(s.organizations)
          .where(
            and(
              eq(s.organizations.id, input.organizationId),
              eq(s.organizations.status, "active"),
            ),
          );
    if (!org) throw new BadRequestException("Choose an active organization.");
    const branch = await requireOrganizationBranch(
      tx,
      input.organizationId,
      input.branchCode,
      input.branchName,
    );
    input.branchCode = branch.code;
    input.branchName = branch.name;
    const [identity] = await tx
      .select({ email: s.user.email })
      .from(s.user)
      .where(sql`lower(${s.user.email}) = ${input.email}`);
    const [member] = await tx
      .select({ studentId: s.members.studentId })
      .from(s.members)
      .where(
        and(
          eq(s.members.organizationId, input.organizationId),
          sql`lower(${s.members.studentId}) = ${input.studentId.toLowerCase()}`,
        ),
      );
    if (identity || member) throw new ConflictException(duplicateMessage);
  }
  async submit(input: RegistrationInput, ip: string) {
    await this.throttle(ip);
    try {
      return await this.publicScope(input.organizationId, async (tx) => {
        await this.ensureAvailable(tx, input);
        const [receipt] = await tx
          .insert(registrationRequests)
          .values({
            ...input,
            cohort: input.cohort || null,
            source: "registration",
            status: "pending",
          })
          .returning({
            id: registrationRequests.id,
            status: registrationRequests.status,
          });
        return receipt;
      });
    } catch (error) {
      if (duplicate(error)) throw new ConflictException(duplicateMessage);
      throw error;
    }
  }
  async list(actor: Actor, organizationId?: string, status = "pending") {
    this.admin(actor);
    return this.service.scope(actor, (tx) =>
      tx
        .select({
          id: registrationRequests.id,
          organizationId: registrationRequests.organizationId,
          organizationName: s.organizations.name,
          studentId: registrationRequests.studentId,
          name: registrationRequests.name,
          email: registrationRequests.email,
          phone: registrationRequests.phone,
          cohort: registrationRequests.cohort,
          branchName: registrationRequests.branchName,
          branchCode: registrationRequests.branchCode,
          source: registrationRequests.source,
          status: registrationRequests.status,
          createdAt: registrationRequests.createdAt,
          reviewedAt: registrationRequests.reviewedAt,
          rejectionReason: registrationRequests.rejectionReason,
          memberId: registrationRequests.memberId,
          emailStatus: s.outbox.status,
        })
        .from(registrationRequests)
        .innerJoin(
          s.organizations,
          eq(s.organizations.id, registrationRequests.organizationId),
        )
        .leftJoin(
          s.outbox,
          eq(s.outbox.id, registrationRequests.welcomeOutboxId),
        )
        .where(
          and(
            organizationId
              ? eq(registrationRequests.organizationId, organizationId)
              : undefined,
            status === "all"
              ? undefined
              : eq(registrationRequests.status, status),
          ),
        )
        .orderBy(desc(registrationRequests.createdAt))
        .limit(2000),
    );
  }
  async import(actor: Actor, organizationId: string, rows: unknown[]) {
    this.admin(actor);
    const results: {
      row: number;
      id?: string;
      status: "pending" | "duplicate" | "invalid";
      message?: string;
    }[] = [];
    for (const [index, row] of rows.entries()) {
      const parsed = z
        .object({ ...registrationFields, collegeName: clean(150).optional() })
        .strict()
        .safeParse(row);
      if (!parsed.success) {
        results.push({
          row: index + 1,
          status: "invalid",
          message: parsed.error.issues[0]?.message || "Check the row fields.",
        });
        continue;
      }
      const { collegeName, ...fields } = parsed.data;
      const input = { organizationId, ...fields };
      try {
        const receipt = await this.service.scope(actor, async (tx) => {
          await this.ensureAvailable(tx, input);
          if (collegeName) {
            const [organization] = await tx
              .select({ name: s.organizations.name })
              .from(s.organizations)
              .where(eq(s.organizations.id, organizationId));
            const normalize = (value: string) =>
              value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
            if (normalize(collegeName) !== normalize(organization.name))
              throw new BadRequestException(
                "College name must match the selected organization.",
              );
          }
          const [request] = await tx
            .insert(registrationRequests)
            .values({
              ...input,
              cohort: input.cohort || null,
              source: "import",
              status: "pending",
            })
            .returning({ id: registrationRequests.id });
          await tx.insert(s.audit).values({
            actorId: actor.id,
            organizationId,
            action: "registration.imported",
            resourceId: request.id,
          });
          return request;
        });
        results.push({ row: index + 1, id: receipt.id, status: "pending" });
      } catch (error) {
        if (duplicate(error) || error instanceof ConflictException)
          results.push({
            row: index + 1,
            status: "duplicate",
            message: duplicateMessage,
          });
        else if (error instanceof BadRequestException)
          results.push({
            row: index + 1,
            status: "invalid",
            message: error.message,
          });
        else throw error;
      }
    }
    return {
      created: results.filter((result) => result.status === "pending").length,
      results,
    };
  }
  private async activeOrganization(tx: Transaction, organizationId: string) {
    const [organization] = await tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, organizationId))
      .for("no key update");
    if (!organization || organization.status !== "active")
      throw new BadRequestException("Choose an active organization.");
    return organization;
  }
  private async branchName(
    tx: Transaction,
    organizationId: string,
    code: string,
    name: string,
  ) {
    return (await requireOrganizationBranch(tx, organizationId, code, name))
      .name;
  }
  async createStudent(
    actor: Actor,
    raw: RegistrationInput,
    collegeName?: string,
  ) {
    this.admin(actor);
    const input = registrationInput.parse(raw);
    try {
      return await this.service.scope(actor, async (tx) => {
        const organization = await this.activeOrganization(
          tx,
          input.organizationId,
        );
        if (
          collegeName &&
          collegeName.trim().replace(/\s+/g, " ").toLowerCase() !==
            organization.name.trim().replace(/\s+/g, " ").toLowerCase()
        )
          throw new BadRequestException(
            "College name must match the selected organization.",
          );
        input.branchName = await this.branchName(
          tx,
          input.organizationId,
          input.branchCode,
          input.branchName,
        );
        const [request] = await tx
          .insert(registrationRequests)
          .values({
            ...input,
            cohort: input.cohort || null,
            source: "import",
            status: "pending",
          })
          .returning();
        return this.provision(
          tx,
          actor,
          request,
          "student.created",
          organization,
        );
      });
    } catch (error) {
      if (
        duplicate(error) ||
        (error as { body?: { code?: string } })?.body?.code ===
          "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
      )
        throw new ConflictException(duplicateMessage);
      throw error;
    }
  }
  async createStudents(actor: Actor, organizationId: string, rows: unknown[]) {
    this.admin(actor);
    const results: {
      row: number;
      id?: string;
      memberId?: string;
      status: "approved" | "duplicate" | "invalid" | "failed";
      message?: string;
    }[] = [];
    for (const [index, row] of rows.entries()) {
      const parsed = z
        .object({ ...registrationFields, collegeName: clean(150).optional() })
        .strict()
        .safeParse(row);
      if (!parsed.success) {
        results.push({
          row: index + 1,
          status: "invalid",
          message: parsed.error.issues[0]?.message || "Check the row fields.",
        });
        continue;
      }
      const { collegeName, ...fields } = parsed.data;
      try {
        const created = await this.createStudent(
          actor,
          { organizationId, ...fields },
          collegeName,
        );
        results.push({
          row: index + 1,
          id: created.id,
          memberId: created.memberId,
          status: "approved",
        });
      } catch (error) {
        results.push({
          row: index + 1,
          status:
            error instanceof ConflictException
              ? "duplicate"
              : error instanceof BadRequestException
                ? "invalid"
                : "failed",
          message:
            error instanceof ConflictException ||
            error instanceof BadRequestException
              ? error.message
              : "Account creation failed. Check configuration and retry this row.",
        });
      }
    }
    return {
      created: results.filter((row) => row.status === "approved").length,
      results,
    };
  }
  private studentLoginUrl() {
    const configuredStudentOrigin = process.env.STUDENT_PORTAL_URL?.trim();
    if (this.service.config.production && !configuredStudentOrigin)
      throw new Error(
        "Configure the student portal origin before approving students.",
      );
    const studentOrigin = new URL(
      configuredStudentOrigin || this.service.config.origins[0],
    );
    if (
      !this.service.config.origins.includes(studentOrigin.origin) ||
      studentOrigin.username ||
      studentOrigin.password ||
      !["http:", "https:"].includes(studentOrigin.protocol) ||
      (this.service.config.production && studentOrigin.protocol !== "https:")
    )
      throw new Error("Configure a trusted student portal origin.");
    return new URL("/login", studentOrigin.origin).toString();
  }
  private async queueWelcome(tx: Transaction, payload: WelcomeMailPayload) {
    const [mail] = await tx
      .insert(s.outbox)
      .values({
        type: "welcome_student",
        encryptedPayload: encryptPayload(this.service.config.secret, payload),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      })
      .returning({ id: s.outbox.id });
    return mail;
  }
  async updateStudent(
    actor: Actor,
    organizationId: string,
    memberId: string,
    raw: z.infer<typeof studentProfileInput>,
  ) {
    this.admin(actor);
    const input = studentProfileInput.parse(raw);
    try {
      return await this.service.scope(actor, async (tx) => {
        // Review/retry lock requests first; organization then member matches
        // access updates. Email delivery never waits on a member lock.
        const requests = await tx
          .select()
          .from(registrationRequests)
          .where(
            and(
              eq(registrationRequests.memberId, memberId),
              eq(registrationRequests.organizationId, organizationId),
              eq(registrationRequests.status, "approved"),
            ),
          )
          .orderBy(registrationRequests.id)
          .for("update");
        const organization = await this.activeOrganization(tx, organizationId);
        const [member] = await tx
          .select()
          .from(s.members)
          .where(
            and(
              eq(s.members.id, memberId),
              eq(s.members.organizationId, organizationId),
              eq(s.members.role, "student"),
            ),
          )
          .for("update");
        if (!member)
          throw new NotFoundException(
            "Student not found in this organization.",
          );
        const [identity] = await tx
          .select()
          .from(s.user)
          .where(eq(s.user.id, member.authUserId))
          .for("update");
        if (!identity)
          throw new NotFoundException("Student identity not found.");
        const emailChanged = input.email !== identity.email.toLowerCase();
        const phoneChanged = input.phone !== member.phone;
        const branchChanged =
          input.branchCode !== member.branchCode ||
          input.branchName !== member.branchName;
        const [duplicateIdentity] = await tx
          .select({ id: s.user.id })
          .from(s.user)
          .where(
            and(
              sql`lower(${s.user.email}) = ${input.email}`,
              ne(s.user.id, member.authUserId),
            ),
          );
        const [conflictingRequest] = await tx
          .select({ id: registrationRequests.id })
          .from(registrationRequests)
          .where(
            and(
              sql`lower(${registrationRequests.email}) = ${input.email}`,
              ne(registrationRequests.status, "rejected"),
              or(
                sql`${registrationRequests.memberId} is null`,
                ne(registrationRequests.memberId, memberId),
              ),
            ),
          );
        if (duplicateIdentity || conflictingRequest)
          throw new ConflictException(duplicateMessage);
        const branchName = await this.branchName(
          tx,
          organizationId,
          input.branchCode,
          input.branchName,
        );
        let welcomeEmailStatus: "pending" | undefined;
        if (emailChanged) {
          const ids = requests.flatMap((request) =>
            request.welcomeOutboxId ? [request.welcomeOutboxId] : [],
          );
          const messages = ids.length
            ? await tx
                .select()
                .from(s.outbox)
                .where(inArray(s.outbox.id, ids))
                .orderBy(s.outbox.id)
                .for("update")
            : [];
          if (messages.some((message) => message.status === "processing"))
            throw new ConflictException(
              "A welcome email is being sent. Wait for delivery to finish, then update the email address.",
            );
          const cancellable = messages
            .filter((message) => ["pending", "failed"].includes(message.status))
            .map((message) => message.id);
          if (cancellable.length)
            await tx
              .update(s.outbox)
              .set({
                status: "expired",
                encryptedPayload: "",
                expiresAt: new Date(),
              })
              .where(inArray(s.outbox.id, cancellable));
          await tx
            .delete(s.verification)
            .where(
              and(
                eq(s.verification.value, member.authUserId),
                sql`${s.verification.identifier} like 'reset-password:%'`,
              ),
            );
          if (!member.passwordSetupComplete) {
            const temporaryPassword =
              randomBytes(24).toString("base64url") + "!a1";
            const credentials = await tx
              .update(s.account)
              .set({
                password: await hashPassword(temporaryPassword),
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(s.account.userId, member.authUserId),
                  eq(s.account.providerId, "credential"),
                ),
              )
              .returning({ id: s.account.id });
            if (!credentials.length)
              throw new ConflictException(
                "This student has no password account to reset.",
              );
            const mail = await this.queueWelcome(tx, {
              userId: member.authUserId,
              email: input.email,
              name: input.name,
              temporaryPassword,
              loginUrl: this.studentLoginUrl(),
              organizationName: organization.name,
              studentId: member.studentId || "Student",
            });
            if (requests.length)
              await tx
                .update(registrationRequests)
                .set({ welcomeOutboxId: mail.id })
                .where(
                  inArray(
                    registrationRequests.id,
                    requests.map((request) => request.id),
                  ),
                );
            welcomeEmailStatus = "pending";
          }
        }
        await tx
          .update(s.user)
          .set({
            name: input.name,
            email: input.email,
            ...(emailChanged ? { emailVerified: false } : {}),
            updatedAt: new Date(),
          })
          .where(eq(s.user.id, member.authUserId));
        const [updated] = await tx
          .update(s.members)
          .set({
            phone: input.phone,
            branchCode: input.branchCode,
            branchName,
            ...(phoneChanged ? { phoneVerifiedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(s.members.id, memberId))
          .returning();
        if (phoneChanged)
          await tx
            .update(s.phoneChallenges)
            .set({ consumedAt: new Date() })
            .where(eq(s.phoneChallenges.memberId, memberId));
        if (emailChanged || phoneChanged)
          await tx
            .delete(s.session)
            .where(eq(s.session.userId, member.authUserId));
        if (requests.length)
          await tx
            .update(registrationRequests)
            .set({
              name: input.name,
              email: input.email,
              phone: input.phone,
              branchName,
              branchCode: input.branchCode,
            })
            .where(
              inArray(
                registrationRequests.id,
                requests.map((request) => request.id),
              ),
            );
        if (branchChanged)
          await tx
            .update(s.organizations)
            .set({
              accessRevision: organization.accessRevision + 1,
              updatedAt: new Date(),
            })
            .where(eq(s.organizations.id, organizationId));
        await this.service.log(
          tx,
          actor,
          "student.profile_updated",
          organizationId,
          memberId,
        );
        return {
          id: updated.id,
          name: input.name,
          email: input.email,
          role: updated.role,
          status: updated.status,
          organizationId: updated.organizationId,
          passwordSetupComplete: updated.passwordSetupComplete,
          phone: updated.phone,
          phoneVerifiedAt: updated.phoneVerifiedAt,
          features: updated.features,
          studentId: updated.studentId,
          cohort: updated.cohort,
          branchName: updated.branchName,
          branchCode: updated.branchCode,
          ...(welcomeEmailStatus ? { welcomeEmailStatus } : {}),
        };
      });
    } catch (error) {
      if (duplicate(error)) throw new ConflictException(duplicateMessage);
      throw error;
    }
  }
  private async provision(
    tx: Transaction,
    actor: Actor,
    request: typeof registrationRequests.$inferSelect,
    action = "registration.approved",
    knownOrganization?: typeof s.organizations.$inferSelect,
  ) {
    const organization =
      knownOrganization ||
      (await this.activeOrganization(tx, request.organizationId));
    request.branchName = await this.branchName(
      tx,
      request.organizationId,
      request.branchCode,
      request.branchName,
    );
    request.branchCode = branchCodeInput.parse(request.branchCode);
    await this.ensureAvailable(
      tx,
      {
        ...request,
        cohort: request.cohort || undefined,
      },
      true,
    );
    const temporaryPassword = randomBytes(24).toString("base64url") + "!a1";
    const auth = createAuth(
      tx as unknown as Database,
      this.service.config,
      false,
    );
    const identity = await auth.api.createUser({
      body: {
        email: request.email,
        name: request.name,
        password: temporaryPassword,
        role: "user",
      },
    });
    const [member] = await tx
      .insert(s.members)
      .values({
        authUserId: identity.user.id,
        organizationId: request.organizationId,
        role: "student",
        status: "active",
        studentId: request.studentId,
        cohort: request.cohort,
        branchName: request.branchName,
        branchCode: request.branchCode,
        phone: request.phone,
        phoneVerifiedAt: null,
        passwordSetupComplete: false,
        features: [],
      })
      .returning({ id: s.members.id });
    const loginUrl = this.studentLoginUrl();
    const payload: WelcomeMailPayload = {
      userId: identity.user.id,
      email: request.email,
      name: request.name,
      temporaryPassword,
      loginUrl,
      organizationName: organization.name,
      studentId: request.studentId,
    };
    const mail = await this.queueWelcome(tx, payload);
    await tx.insert(s.audit).values({
      actorId: actor.id,
      organizationId: request.organizationId,
      action,
      resourceId: request.id,
    });
    await tx
      .update(registrationRequests)
      .set({
        status: "approved",
        memberId: member.id,
        welcomeOutboxId: mail.id,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
      })
      .where(eq(registrationRequests.id, request.id));
    return {
      id: request.id,
      memberId: member.id,
      status: "approved" as const,
      emailStatus: "pending" as const,
    };
  }
  async approve(actor: Actor, ids: string[]) {
    this.admin(actor);
    const results: {
      id: string;
      status: "approved" | "already_approved" | "rejected" | "failed";
      message?: string;
    }[] = [];
    for (const id of ids) {
      try {
        const status = await this.service.scope(actor, async (tx) => {
          const [request] = await tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.id, id))
            .for("update");
          if (!request) throw new NotFoundException("Registration not found.");
          if (request.status === "approved") return "already_approved" as const;
          if (request.status === "rejected") return "rejected" as const;
          await this.provision(tx, actor, request);
          return "approved" as const;
        });
        results.push({ id, status });
      } catch {
        results.push({
          id,
          status: "failed",
          message:
            "This request could not be approved. Check existing accounts and configuration, then retry.",
        });
      }
    }
    return { results };
  }
  async reject(actor: Actor, id: string, reason: string) {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const [request] = await tx
        .select()
        .from(registrationRequests)
        .where(eq(registrationRequests.id, id))
        .for("update");
      if (!request) throw new NotFoundException("Registration not found.");
      if (request.status === "approved")
        throw new ConflictException(
          "An approved registration cannot be rejected.",
        );
      if (request.status === "rejected") return { id, status: "rejected" };
      await tx
        .update(registrationRequests)
        .set({
          status: "rejected",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          rejectionReason: reason,
        })
        .where(eq(registrationRequests.id, id));
      await tx.insert(s.audit).values({
        actorId: actor.id,
        organizationId: request.organizationId,
        action: "registration.rejected",
        resourceId: id,
      });
      return { id, status: "rejected" };
    });
  }
  async retryEmail(actor: Actor, id: string) {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const [request] = await tx
        .select()
        .from(registrationRequests)
        .where(eq(registrationRequests.id, id))
        .for("update");
      if (!request?.welcomeOutboxId || request.status !== "approved")
        throw new ConflictException(
          "Approve this registration before sending welcome email.",
        );
      const [mail] = await tx
        .select()
        .from(s.outbox)
        .where(eq(s.outbox.id, request.welcomeOutboxId))
        .for("update");
      if (
        !mail ||
        mail.status !== "failed" ||
        mail.expiresAt <= new Date() ||
        !mail.encryptedPayload
      )
        throw new ConflictException(
          "Only failed, unexpired welcome emails can be retried. Use password reset for expired credentials.",
        );
      await tx
        .update(s.outbox)
        .set({ status: "pending", attempts: 0, availableAt: new Date() })
        .where(eq(s.outbox.id, mail.id));
      await tx.insert(s.audit).values({
        actorId: actor.id,
        organizationId: request.organizationId,
        action: "registration.email_retried",
        resourceId: id,
      });
      return { id, emailStatus: "pending" };
    });
  }
}
