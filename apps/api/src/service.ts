import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import {
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { fromNodeHeaders } from "better-auth/node";
import type { Course, Identity, Lesson, Role, Resume } from "@slate/contracts";
import type { Auth } from "./auth.js";
import type { Config } from "./config.js";
import { scoped, type Database, type Transaction } from "./database.js";
import { createUpload, r2Configured, type PhoneSender } from "./providers.js";
import * as s from "./schema.js";
import {
  demoAnnouncements,
  demoExams,
  demoOrganization,
  demoPerformance,
  demoPractice,
} from "./demo-data.js";

export type Actor = Identity & {
  authId: string;
  features: string[];
  sessionId: string;
};
const unexpired = () =>
  or(isNull(s.grants.expiresAt), gt(s.grants.expiresAt, new Date()));
export class SlateService {
  constructor(
    readonly db: Database,
    readonly auth: Auth,
    readonly config: Config,
    readonly phoneSender: PhoneSender,
    readonly local: boolean,
  ) {}
  async actor(
    request: Request,
    role?: Role,
    onboarding = false,
  ): Promise<Actor> {
    let identity: {
      user: {
        id: string;
        name: string;
        email: string;
        twoFactorEnabled?: boolean | null;
      };
      session: { id: string; createdAt: Date; updatedAt: Date };
    } | null = null;
    const bearer = request.headers.authorization;
    if (bearer) {
      if (!bearer.startsWith("Bearer ") || bearer.length > 8192)
        throw new UnauthorizedException();
      try {
        const keys = await this.auth.api.getJwks();
        const verified = await jwtVerify(
          bearer.slice(7),
          createLocalJWKSet(keys),
          { issuer: this.config.authUrl, audience: "otp-slate-api" },
        );
        if (
          typeof verified.payload.sid !== "string" ||
          typeof verified.payload.sub !== "string"
        )
          throw new Error("Missing session binding");
        const [record] = await this.db
          .select({ session: s.session, user: s.user })
          .from(s.session)
          .innerJoin(s.user, eq(s.session.userId, s.user.id))
          .where(
            and(
              eq(s.session.id, verified.payload.sid),
              eq(s.user.id, verified.payload.sub),
              gt(s.session.expiresAt, new Date()),
            ),
          );
        if (record) identity = record;
      } catch {
        throw new UnauthorizedException(
          "Your session has expired. Sign in again.",
        );
      }
    } else
      identity = await this.auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
        query: { disableCookieCache: true, disableRefresh: true },
      });
    if (!identity) throw new UnauthorizedException("Sign in to continue.");
    const found = await scoped(
      this.db,
      { authId: identity.user.id },
      async (tx) => {
        const [member] = await tx
          .select()
          .from(s.members)
          .where(eq(s.members.authUserId, identity!.user.id));
        return member;
      },
    );
    if (!found || found.status !== "active")
      throw new ForbiddenException(
        "This account is not active. Contact Platform Admin.",
      );
    const memberRole = found.role as Role;
    if (role && memberRole !== role)
      throw new ForbiddenException(
        "This portal is not available to your account.",
      );
    const idleLimit =
      memberRole === "platform_admin" ? 15 * 60_000 : 30 * 60_000;
    if (
      identity.session.createdAt.getTime() < Date.now() - 8 * 3600_000 ||
      identity.session.updatedAt.getTime() < Date.now() - idleLimit
    ) {
      await this.db
        .delete(s.session)
        .where(eq(s.session.id, identity.session.id));
      throw new UnauthorizedException(
        "Your session has expired. Sign in again.",
      );
    }
    let organizationName: string | null = null;
    if (found.organizationId) {
      const org = await scoped(
        this.db,
        { organizationId: found.organizationId },
        async (tx) =>
          (
            await tx
              .select()
              .from(s.organizations)
              .where(eq(s.organizations.id, found.organizationId!))
          )[0],
      );
      if (!org || org.status !== "active")
        throw new ForbiddenException("This organization is not active.");
      organizationName = org.name;
    }
    const onboardingStep = !found.passwordSetupComplete
      ? "password"
      : memberRole === "student" && !found.phoneVerifiedAt
        ? "phone"
        : memberRole === "platform_admin" &&
            this.config.production &&
            !identity.user.twoFactorEnabled
          ? "mfa"
          : null;
    if (onboardingStep && !onboarding)
      throw new ForbiddenException(
        "Complete your account setup before continuing.",
      );
    await this.db
      .update(s.session)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(s.session.id, identity.session.id),
          lt(s.session.updatedAt, new Date(Date.now() - 60_000)),
        ),
      );
    return {
      id: found.id,
      authId: identity.user.id,
      sessionId: identity.session.id,
      name: identity.user.name,
      email: identity.user.email,
      role: memberRole,
      organizationId: found.organizationId,
      organizationName,
      onboardingStep,
      features: found.features,
      demo:
        this.local &&
        !this.config.production &&
        (demoOrganization(organizationName) ||
          identity.user.email === "admin@slate.test"),
    };
  }
  scope<T>(
    actor: Actor,
    work: (tx: Transaction) => Promise<T>,
    readonly = false,
  ) {
    return scoped(
      this.db,
      {
        authId: actor.authId,
        organizationId: actor.organizationId,
        platform: actor.role === "platform_admin",
        readonly,
      },
      work,
    );
  }
  publicIdentity(actor: Actor) {
    const { authId, sessionId, ...result } = actor;
    return result;
  }
  practice(actor: Actor) {
    return actor.demo ? demoPractice : [];
  }
  exams(actor: Actor) {
    return actor.demo ? demoExams() : [];
  }
  announcements(actor: Actor) {
    return actor.demo ? demoAnnouncements() : [];
  }
  async demoPreview(actor: Actor, organizationId: string) {
    const [organization] = await this.scope(actor, (tx) =>
      tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, organizationId)),
    );
    if (
      !this.local ||
      this.config.production ||
      !demoOrganization(organization?.name)
    )
      return { sample: false, practice: [], exams: [], announcements: [] };
    return {
      sample: true,
      practice: demoPractice,
      exams: demoExams(),
      announcements: demoAnnouncements(),
    };
  }
  feature(actor: Actor, name: string) {
    if (!actor.features.includes(name))
      throw new ForbiddenException(
        "Platform Admin has not assigned this feature.",
      );
  }
  async log(
    tx: Transaction,
    actor: Actor,
    action: string,
    organizationId: string | null,
    resourceId: string,
  ) {
    await tx
      .insert(s.audit)
      .values({ actorId: actor.id, action, organizationId, resourceId });
  }
  integrations() {
    return {
      database: this.local ? "local-postgres" : "neon-compatible-postgres",
      email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
      whatsapp: this.phoneSender.configured,
      storage: r2Configured(),
      execution: process.env.EXECUTION_PROVIDER || "unconfigured",
      environment: this.config.production ? "production" : "development",
    };
  }
  async organizations(actor: Actor) {
    return this.scope(actor, (tx) =>
      tx
        .select()
        .from(s.organizations)
        .orderBy(desc(s.organizations.createdAt)),
    );
  }
  async summary(actor: Actor) {
    return this.scope(actor, async (tx) => {
      const [orgs] = await tx.select({ total: count() }).from(s.organizations);
      const [students] = await tx
        .select({ total: count() })
        .from(s.members)
        .where(eq(s.members.role, "student"));
      const [viewers] = await tx
        .select({ total: count() })
        .from(s.members)
        .where(eq(s.members.role, "organization_viewer"));
      const [courses] = await tx
        .select({ total: count() })
        .from(s.courses)
        .where(eq(s.courses.status, "published"));
      return {
        organizations: orgs.total,
        students: students.total,
        viewers: viewers.total,
        publishedCourses: courses.total,
      };
    });
  }
  async createOrganization(actor: Actor, name: string) {
    return this.scope(actor, async (tx) => {
      const [org] = await tx
        .insert(s.organizations)
        .values({ name })
        .returning();
      await this.log(tx, actor, "organization.created", org.id, org.id);
      return org;
    });
  }
  async listMembers(actor: Actor, organizationId: string) {
    return this.scope(actor, (tx) =>
      tx
        .select({
          id: s.members.id,
          name: s.user.name,
          email: s.user.email,
          role: s.members.role,
          status: s.members.status,
          organizationId: s.members.organizationId,
          passwordSetupComplete: s.members.passwordSetupComplete,
          phoneVerifiedAt: s.members.phoneVerifiedAt,
          features: s.members.features,
        })
        .from(s.members)
        .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
        .where(eq(s.members.organizationId, organizationId))
        .orderBy(s.user.name)
        .limit(2000),
    );
  }
  async createMember(
    actor: Actor,
    input: {
      organizationId: string;
      name: string;
      email: string;
      role: "student" | "organization_viewer";
    },
  ) {
    const org = await this.scope(
      actor,
      async (tx) =>
        (
          await tx
            .select()
            .from(s.organizations)
            .where(eq(s.organizations.id, input.organizationId))
        )[0],
    );
    if (!org || org.status !== "active")
      throw new NotFoundException("Choose an active organization.");
    const temporaryPassword = randomBytes(18).toString("base64url") + "!a1";
    const identity = await this.auth.api.createUser({
      body: {
        email: input.email,
        name: input.name,
        password: temporaryPassword,
        role: "user",
      },
    });
    try {
      const member = await this.scope(actor, async (tx) => {
        const [record] = await tx
          .insert(s.members)
          .values({
            authUserId: identity.user.id,
            organizationId: input.organizationId,
            role: input.role,
          })
          .returning();
        await this.log(
          tx,
          actor,
          "member.provisioned",
          input.organizationId,
          record.id,
        );
        return record;
      });
      return {
        id: member.id,
        name: input.name,
        email: input.email,
        temporaryPassword,
      };
    } catch (error) {
      await this.db.delete(s.user).where(eq(s.user.id, identity.user.id));
      throw error;
    }
  }
  async updateMember(
    actor: Actor,
    id: string,
    input: {
      status?: "active" | "suspended" | "disabled";
      features?: string[];
    },
  ) {
    return this.scope(actor, async (tx) => {
      const [member] = await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, id))
        .for("update");
      if (!member || member.role === "platform_admin")
        throw new NotFoundException();
      const [record] = await tx
        .update(s.members)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(s.members.id, id))
        .returning();
      if (input.status && input.status !== "active")
        await tx
          .delete(s.session)
          .where(eq(s.session.userId, member.authUserId));
      await this.log(tx, actor, "member.updated", member.organizationId, id);
      return {
        id: record.id,
        status: record.status,
        features: record.features,
      };
    });
  }
  async setPassword(
    actor: Actor,
    currentPassword: string,
    newPassword: string,
    headers: Request["headers"],
  ) {
    const response = await this.auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: fromNodeHeaders(headers),
      asResponse: true,
    });
    if (!response.ok)
      throw new BadRequestException(
        "Check your current password and use a password with at least 12 characters.",
      );
    await this.scope(actor, (tx) =>
      tx
        .update(s.members)
        .set({ passwordSetupComplete: true, updatedAt: new Date() })
        .where(eq(s.members.id, actor.id)),
    );
    return response;
  }
  private challengeHash(
    id: string,
    member: string,
    phone: string,
    code: string,
  ) {
    return createHmac("sha256", this.config.secret)
      .update(JSON.stringify([id, member, phone, code]))
      .digest("hex");
  }
  async sendPhone(actor: Actor, phone: string) {
    if (actor.onboardingStep !== "phone")
      throw new ForbiddenException("Complete password setup first.");
    if (!this.phoneSender.configured)
      throw new ServiceUnavailableException(
        "Phone verification is not available yet. Contact Platform Admin.",
      );
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await this.scope(actor, async (tx) => {
      // Serialize concurrent sends for this account; counters are shared across API replicas.
      await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, actor.id))
        .for("update");
      const recent = await tx
        .select()
        .from(s.phoneChallenges)
        .where(
          and(
            eq(s.phoneChallenges.memberId, actor.id),
            gt(s.phoneChallenges.createdAt, new Date(Date.now() - 3600_000)),
          ),
        )
        .orderBy(desc(s.phoneChallenges.createdAt));
      if (
        recent.length >= 5 ||
        (recent[0] && recent[0].createdAt.getTime() > Date.now() - 60_000)
      )
        throw new BadRequestException(
          "Please wait before requesting another code.",
        );
      await tx
        .update(s.phoneChallenges)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(s.phoneChallenges.memberId, actor.id),
            isNull(s.phoneChallenges.consumedAt),
          ),
        );
      await tx.insert(s.phoneChallenges).values({
        id,
        organizationId: actor.organizationId!,
        memberId: actor.id,
        phone,
        codeHash: this.challengeHash(id, actor.id, phone, code),
        expiresAt: new Date(Date.now() + 300_000),
      });
    });
    try {
      await this.phoneSender.send(phone, code);
    } catch {
      await this.scope(actor, (tx) =>
        tx
          .update(s.phoneChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(s.phoneChallenges.id, id)),
      );
      throw new ServiceUnavailableException(
        "The code could not be sent. Please retry later.",
      );
    }
    return { challengeId: id, expiresIn: 300 };
  }
  async verifyPhone(actor: Actor, id: string, code: string) {
    if (actor.onboardingStep !== "phone") throw new ForbiddenException();
    const valid = await this.scope(actor, async (tx) => {
      const [challenge] = await tx
        .select()
        .from(s.phoneChallenges)
        .where(
          and(
            eq(s.phoneChallenges.id, id),
            eq(s.phoneChallenges.memberId, actor.id),
          ),
        )
        .for("update");
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt.getTime() < Date.now() ||
        challenge.attempts >= 5
      )
        return false;
      await tx
        .update(s.phoneChallenges)
        .set({ attempts: challenge.attempts + 1 })
        .where(eq(s.phoneChallenges.id, id));
      if (
        !timingSafeEqual(
          Buffer.from(challenge.codeHash, "hex"),
          Buffer.from(
            this.challengeHash(id, actor.id, challenge.phone, code),
            "hex",
          ),
        )
      )
        return false;
      await tx
        .update(s.phoneChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(s.phoneChallenges.id, id));
      await tx
        .update(s.members)
        .set({
          phone: challenge.phone,
          phoneVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(s.members.id, actor.id));
      await tx.delete(s.session).where(eq(s.session.userId, actor.authId));
      return true;
    });
    if (!valid)
      throw new BadRequestException("The code is invalid or expired.");
    return { verified: true, requiresSignIn: true };
  }
  async catalog(actor: Actor) {
    if (actor.role === "platform_admin")
      return this.scope(actor, (tx) =>
        tx.select().from(s.courses).orderBy(s.courses.title),
      );
    return this.scope(actor, (tx) =>
      tx
        .select({
          id: s.courses.id,
          title: s.versions.title,
          description: s.versions.description,
          track: s.courses.track,
          status: s.courses.status,
          versionId: s.versions.id,
          version: s.versions.number,
        })
        .from(s.grants)
        .innerJoin(s.courses, eq(s.grants.courseId, s.courses.id))
        .innerJoin(s.versions, eq(s.grants.versionId, s.versions.id))
        .where(and(eq(s.grants.memberId, actor.id), unexpired()))
        .orderBy(s.versions.title),
    );
  }
  async createCourse(
    actor: Actor,
    input: { title: string; description: string; track: string },
  ) {
    return this.scope(actor, async (tx) => {
      const [course] = await tx.insert(s.courses).values(input).returning();
      await this.log(tx, actor, "course.created", null, course.id);
      return course;
    });
  }
  async course(
    actor: Actor,
    id: string,
  ): Promise<Course & { lessons: Lesson[]; completedLessonIds: string[] }> {
    return this.scope(actor, async (tx) => {
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, id));
      if (!course) throw new NotFoundException();
      let version: typeof s.versions.$inferSelect | undefined;
      if (actor.role === "platform_admin")
        [version] = await tx
          .select()
          .from(s.versions)
          .where(eq(s.versions.courseId, id))
          .orderBy(desc(s.versions.number))
          .limit(1);
      else {
        const [grant] = await tx
          .select()
          .from(s.grants)
          .where(
            and(
              eq(s.grants.memberId, actor.id),
              eq(s.grants.courseId, id),
              unexpired(),
            ),
          );
        if (!grant)
          throw new ForbiddenException(
            "This course has not been assigned to you.",
          );
        [version] = await tx
          .select()
          .from(s.versions)
          .where(eq(s.versions.id, grant.versionId));
      }
      const completed =
        version && actor.role === "student"
          ? await tx
              .select()
              .from(s.progress)
              .where(
                and(
                  eq(s.progress.memberId, actor.id),
                  eq(s.progress.versionId, version.id),
                ),
              )
          : [];
      return {
        ...course,
        ...(version
          ? {
              title: version.title,
              description: version.description,
              versionId: version.id,
              version: version.number,
              lessons: version.lessons,
            }
          : { lessons: [] }),
        completedLessonIds: completed.map((p) => p.lessonId),
      };
    });
  }
  async publishCourse(
    actor: Actor,
    id: string,
    input: {
      title: string;
      description: string;
      lessons: { id?: string; title: string; body: string }[];
    },
  ) {
    return this.scope(actor, async (tx) => {
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, id))
        .for("update");
      if (!course) throw new NotFoundException();
      const [previous] = await tx
        .select()
        .from(s.versions)
        .where(eq(s.versions.courseId, id))
        .orderBy(desc(s.versions.number))
        .limit(1);
      const [version] = await tx
        .insert(s.versions)
        .values({
          courseId: id,
          number: (previous?.number || 0) + 1,
          title: input.title,
          description: input.description,
          lessons: input.lessons.map((lesson) => ({
            ...lesson,
            id: lesson.id || randomUUID(),
          })),
        })
        .returning();
      await tx
        .update(s.courses)
        .set({
          title: input.title,
          description: input.description,
          status: "published",
          updatedAt: new Date(),
        })
        .where(eq(s.courses.id, id));
      await this.log(tx, actor, "course.version_published", null, version.id);
      return version;
    });
  }
  async assign(actor: Actor, memberId: string, courseId: string) {
    return this.scope(actor, async (tx) => {
      const [member] = await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, memberId));
      if (!member || member.role !== "student" || member.status !== "active")
        throw new BadRequestException("Choose an active student.");
      const [version] = await tx
        .select()
        .from(s.versions)
        .where(eq(s.versions.courseId, courseId))
        .orderBy(desc(s.versions.number))
        .limit(1);
      if (!version)
        throw new BadRequestException(
          "Publish a course version before assigning it.",
        );
      const [grant] = await tx
        .insert(s.grants)
        .values({
          organizationId: member.organizationId!,
          memberId,
          courseId,
          versionId: version.id,
        })
        .onConflictDoUpdate({
          target: [s.grants.memberId, s.grants.courseId],
          set: { versionId: version.id, expiresAt: null },
        })
        .returning();
      await this.log(
        tx,
        actor,
        "course.assigned",
        member.organizationId,
        grant.id,
      );
      return grant;
    });
  }
  async completeLesson(actor: Actor, courseId: string, lessonId: string) {
    const course = await this.course(actor, courseId);
    if (
      !course.versionId ||
      !course.lessons.some((lesson) => lesson.id === lessonId)
    )
      throw new NotFoundException();
    await this.scope(actor, (tx) =>
      tx
        .insert(s.progress)
        .values({
          organizationId: actor.organizationId!,
          memberId: actor.id,
          versionId: course.versionId!,
          lessonId,
        })
        .onConflictDoNothing(),
    );
    return { completed: true };
  }
  async listJobs(actor: Actor, organizationId?: string) {
    if (actor.role === "student") this.feature(actor, "jobs");
    return this.scope(actor, (tx) =>
      tx
        .select()
        .from(s.jobs)
        .where(
          eq(s.jobs.organizationId, actor.organizationId || organizationId!),
        )
        .orderBy(desc(s.jobs.postedAt)),
    );
  }
  async createJob(
    actor: Actor,
    input: {
      organizationId: string;
      title: string;
      company: string;
      description: string;
      url: string;
    },
  ) {
    return this.scope(actor, async (tx) => {
      const [job] = await tx.insert(s.jobs).values(input).returning();
      await this.log(tx, actor, "job.published", input.organizationId, job.id);
      return job;
    });
  }
  async getResume(actor: Actor) {
    this.feature(actor, "resume");
    return this.scope(
      actor,
      async (tx) =>
        (
          await tx
            .select()
            .from(s.resumes)
            .where(eq(s.resumes.memberId, actor.id))
        )[0] || { data: null, revision: 0 },
    );
  }
  async rankings(actor: Actor) {
    this.feature(actor, "rankings");
    const people = await this.scope(actor, (tx) =>
      tx
        .select({ id: s.members.id, name: s.user.name })
        .from(s.members)
        .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
        .where(
          and(
            eq(s.members.organizationId, actor.organizationId!),
            eq(s.members.role, "student"),
          ),
        )
        .orderBy(s.user.name),
    );
    if (!actor.demo) return people;
    return demoPerformance(people)
      .results.map((result) => ({
        id: result.studentId,
        name: result.name,
        points: result.average * 100 + result.attempts,
        sample: true,
      }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name))
      .map((person, index) => ({ ...person, rank: index + 1 }));
  }
  async saveResume(actor: Actor, data: Resume, revision: number) {
    this.feature(actor, "resume");
    return this.scope(actor, async (tx) => {
      const rows =
        revision === 0
          ? await tx
              .insert(s.resumes)
              .values({
                organizationId: actor.organizationId!,
                memberId: actor.id,
                data,
              })
              .onConflictDoNothing()
              .returning()
          : await tx
              .update(s.resumes)
              .set({ data, revision: revision + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(s.resumes.memberId, actor.id),
                  eq(s.resumes.revision, revision),
                ),
              )
              .returning();
      if (!rows[0])
        throw new ConflictException(
          "Your resume changed in another window. Reload before saving.",
        );
      return rows[0];
    });
  }
  async analytics(actor: Actor) {
    return this.scope(
      actor,
      async (tx) => {
        const [organization] = await tx
          .select()
          .from(s.organizations)
          .where(eq(s.organizations.id, actor.organizationId!));
        const roster = await tx
          .select({
            id: s.members.id,
            name: s.user.name,
            email: s.user.email,
            status: s.members.status,
          })
          .from(s.members)
          .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
          .where(
            and(
              eq(s.members.organizationId, actor.organizationId!),
              eq(s.members.role, "student"),
            ),
          );
        const assigned = await tx
          .select({
            memberId: s.grants.memberId,
            versionId: s.grants.versionId,
            lessons: s.versions.lessons,
          })
          .from(s.grants)
          .innerJoin(s.versions, eq(s.grants.versionId, s.versions.id))
          .where(unexpired());
        const completed = await tx.select().from(s.progress);
        const students = roster.map((member) => {
          const own = assigned.filter((g) => g.memberId === member.id);
          const totalLessons = own.reduce((n, g) => n + g.lessons.length, 0);
          const completedLessons = own.reduce(
            (n, g) =>
              n +
              completed.filter(
                (p) =>
                  p.memberId === member.id &&
                  p.versionId === g.versionId &&
                  g.lessons.some((l) => l.id === p.lessonId),
              ).length,
            0,
          );
          return {
            id: member.id,
            name: member.name,
            email: member.email,
            status: member.status,
            assignedCourses: own.length,
            totalLessons,
            completedLessons,
            completion: totalLessons
              ? Math.round((completedLessons / totalLessons) * 100)
              : null,
          };
        });
        return {
          organization,
          demo: actor.demo,
          ...(actor.demo ? { performance: demoPerformance(students) } : {}),
          students,
          totals: {
            students: students.length,
            active: students.filter((m) => m.status === "active").length,
            assignedCourses: students.reduce(
              (n, m) => n + m.assignedCourses,
              0,
            ),
            completedLessons: students.reduce(
              (n, m) => n + m.completedLessons,
              0,
            ),
          },
          generatedAt: new Date().toISOString(),
        };
      },
      true,
    );
  }
  async upload(actor: Actor, contentType: string) {
    if (!r2Configured())
      throw new ServiceUnavailableException(
        "Configure private R2 storage before uploading.",
      );
    const key = `platform/${actor.id}/${randomUUID()}`;
    return { key, url: await createUpload(key, contentType), expiresIn: 300 };
  }
}
