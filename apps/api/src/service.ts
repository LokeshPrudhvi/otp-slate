import { JobLogoService } from "./job-logos.js";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { randomBytes, randomUUID } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { fromNodeHeaders } from "better-auth/node";
import type { Course, Identity, Lesson, Role, Resume } from "@slate/contracts";
import {
  lessonInput,
  redactLesson,
  type PublishLesson,
} from "./lesson-input.js";
import {
  resolveCourseCovers,
  validateCourseCover,
  type CourseCoverInput,
} from "./course-catalog.js";
import { r2LessonStorage, type LessonStorage } from "./lesson-storage.js";
import { validateQuestionImages } from "./question-images.js";
import { createAuth, type Auth } from "./auth.js";
import type { Config } from "./config.js";
import { scoped, type Database, type Transaction } from "./database.js";
import { createUpload, r2Configured } from "./providers.js";
import * as s from "./schema.js";
import {
  AccessService,
  resolvePolicies,
  supportedDisplay,
  supportedFeatures,
} from "./access.js";
import { ExamService } from "./exams.js";
import { AnnouncementService } from "./announcements.js";
import { lockOrganizationBranches } from "./branches.js";
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
  courseVersionIds?: Record<string, string>;
};
const unexpired = () =>
  or(isNull(s.grants.expiresAt), gt(s.grants.expiresAt, new Date()));
export class SlateService {
  constructor(
    readonly db: Database,
    readonly auth: Auth,
    readonly config: Config,
    readonly local: boolean,
    readonly lessonStorage: LessonStorage = r2LessonStorage,
  ) {}
  async actor(
    request: Request,
    role?: Role,
    onboarding = false,
  ): Promise<Actor> {
    return this.authenticate(request, role, onboarding, async (actor) => actor);
  }
  // Read the current session, membership and access rules for every request.
  // Course reads can use this transaction after all authorization checks pass.
  private async authenticate<T>(
    request: Request,
    role: Role | undefined,
    onboarding: boolean,
    work: (actor: Actor, tx: Transaction) => Promise<T>,
  ): Promise<T> {
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
    let expired = false;
    let result: T;
    try {
      result = await scoped(
        this.db,
        { authId: identity.user.id },
        async (tx) => {
          const [found] = await tx
            .select()
            .from(s.members)
            .where(eq(s.members.authUserId, identity!.user.id));
          if (!found || found.status !== "active")
            throw new ForbiddenException(
              "This account is not active. Contact Platform Admin.",
            );
          if (role && found.role !== role)
            throw new ForbiddenException(
              found.role === "organization_viewer"
                ? "This is an organization viewer account. Sign in through the Organization Admin portal. Student access requires an approved student account."
                : found.role === "student"
                  ? "This is a student account. Sign in through the Student portal."
                  : found.role === "platform_admin"
                    ? "This is a Platform Admin account. Sign in through the Platform Admin portal."
                    : "This portal is not available to your account.",
            );
          const memberRole = found.role as Role;
          const idleLimit =
            memberRole === "platform_admin" ? 15 * 60_000 : 30 * 60_000;
          if (
            identity.session.createdAt.getTime() < Date.now() - 8 * 3600_000 ||
            identity.session.updatedAt.getTime() < Date.now() - idleLimit
          ) {
            expired = true;
            throw new UnauthorizedException(
              "Your session has expired. Sign in again.",
            );
          }
          const onboardingStep = !found.passwordSetupComplete
            ? "password"
            : memberRole === "platform_admin" &&
                this.config.production &&
                !identity.user.twoFactorEnabled
              ? "mfa"
              : null;
          if (onboardingStep && !onboarding)
            throw new ForbiddenException(
              "Complete your account setup before continuing.",
            );

          let organization: typeof s.organizations.$inferSelect | undefined;
          let resolved: ReturnType<typeof resolvePolicies> | undefined;
          if (found.organizationId) {
            // Execute on this same connection in order. Only validated membership
            // establishes tenant context; drain both results before rollback.
            const setup = tx
              .execute(
                sql`select set_config('slate.org_id', ${found.organizationId}, true)`,
              )
              .execute();
            const snapshot =
              found.role === "student" && found.passwordSetupComplete
                ? new AccessService(this).snapshot(tx, found)
                : tx
                    .select()
                    .from(s.organizations)
                    .where(eq(s.organizations.id, found.organizationId))
                    .then((organizations) => ({
                      organization: organizations[0],
                      branchCode: found.branchCode,
                      records: [],
                      grants: [],
                    }));
            const results = await Promise.allSettled([setup, snapshot]);
            for (const item of results)
              if (item.status === "rejected") throw item.reason;
            const access = (
              results[1] as PromiseFulfilledResult<Awaited<typeof snapshot>>
            ).value;
            organization = access.organization;
            if (!organization || organization.status !== "active")
              throw new ForbiddenException("This organization is not active.");
            if (found.role === "student" && found.passwordSetupComplete)
              resolved = resolvePolicies(
                organization,
                { ...found, branchCode: access.branchCode },
                access.records,
                access.grants,
                this.local &&
                  !this.config.production &&
                  demoOrganization(organization.name),
              );
          }
          const organizationName = organization?.name ?? null;
          const actor: Actor = {
            id: found.id,
            authId: identity.user.id,
            sessionId: identity.session.id,
            name: identity.user.name,
            email: identity.user.email,
            role: memberRole,
            organizationId: found.organizationId,
            organizationName,
            onboardingStep,
            features: supportedFeatures(found.features),
            demo:
              this.local &&
              !this.config.production &&
              (demoOrganization(organizationName) ||
                identity.user.email === "admin@slate.test"),
          };
          if (resolved) {
            actor.access = resolved.effective;
            actor.features = resolved.effective.features;
            actor.courseVersionIds = resolved.versionIds;
          }
          return work(actor, tx);
        },
      );
    } catch (error) {
      // Release/roll back the scoped connection before deleting an expired
      // session; otherwise concurrent expiry could exhaust the connection pool.
      if (expired)
        await this.db
          .delete(s.session)
          .where(eq(s.session.id, identity.session.id));
      throw error;
    }
    const activityCutoff = new Date(Date.now() - 60_000);
    if (
      !(request.path?.endsWith("/me") && request.query?.passive === "1") &&
      identity.session.updatedAt < activityCutoff
    )
      await this.db
        .update(s.session)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(s.session.id, identity.session.id),
            lt(s.session.updatedAt, activityCutoff),
          ),
        );
    return result;
  }
  studentCatalog(request: Request) {
    return this.authenticate(request, "student", false, (actor, tx) =>
      this.catalog(actor, tx),
    );
  }
  studentCourse(request: Request, id: string) {
    return this.authenticate(request, "student", false, (actor, tx) =>
      this.course(actor, id, tx),
    );
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
    const { authId, sessionId, courseVersionIds, ...result } = actor;
    return result;
  }
  practice(actor: Actor) {
    this.feature(actor, "practice");
    return demoPractice.filter(
      (item) =>
        item.kind === "coding" &&
        (actor.access?.practiceModuleIds.includes("competitive-coding") ??
          actor.demo) &&
        actor.features.includes("compiler"),
    );
  }
  exams(actor: Actor) {
    return new ExamService(this).studentList(actor);
  }
  announcements(actor: Actor) {
    return new AnnouncementService(this).student(actor);
  }
  async mailboxActor(request: Request) {
    const actor = await this.actor(request);
    if (actor.role === "student") this.feature(actor, "inbox");
    return actor;
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
      practice: demoPractice.filter((item) => item.kind === "coding"),
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
        .orderBy(desc(s.organizations.createdAt))
        .then((rows) =>
          rows.map((row) => ({
            ...row,
            portalDisplay: row.portalDisplay
              ? supportedDisplay(row.portalDisplay)
              : null,
          })),
        ),
    );
  }
  async summary(actor: Actor) {
    return this.scope(actor, async (tx) => {
      const result = await tx.execute(sql`
        select
          (select count(*) from ${s.organizations}) as organizations,
          (select count(*) from ${s.members} where ${s.members.role} = 'student') as students,
          (select count(*) from ${s.members} where ${s.members.role} = 'organization_viewer') as viewers,
          (select count(*) from ${s.courses} where ${s.courses.status} = 'published') as published_courses
      `);
      const totals = result.rows[0];
      return {
        organizations: Number(totals.organizations),
        students: Number(totals.students),
        viewers: Number(totals.viewers),
        publishedCourses: Number(totals.published_courses),
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
  async updateOrganizationStatus(
    actor: Actor,
    organizationId: string,
    status: "active" | "archived",
  ) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException(
        "Only Platform Admin can archive or restore organizations.",
      );
    return this.scope(actor, async (tx) => {
      const [organization] = await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, organizationId))
        .for("update");
      if (!organization) throw new NotFoundException("Organization not found.");
      if (organization.status === status)
        return {
          ...organization,
          portalDisplay: organization.portalDisplay
            ? supportedDisplay(organization.portalDisplay)
            : null,
        };
      const [updated] = await tx
        .update(s.organizations)
        .set({
          status,
          accessRevision: sql`${s.organizations.accessRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(s.organizations.id, organizationId))
        .returning();
      // Revoke on restore too: a login attempted while archived must not become
      // a valid session later. Individual member statuses and learning stay intact.
      await tx
        .delete(s.session)
        .where(
          inArray(
            s.session.userId,
            tx
              .select({ id: s.members.authUserId })
              .from(s.members)
              .where(eq(s.members.organizationId, organizationId)),
          ),
        );
      await this.log(
        tx,
        actor,
        status === "archived"
          ? "organization.archived"
          : "organization.restored",
        organizationId,
        organizationId,
      );
      return {
        ...updated,
        portalDisplay: updated.portalDisplay
          ? supportedDisplay(updated.portalDisplay)
          : null,
      };
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
          phone: s.members.phone,
          features: s.members.features,
          studentId: s.members.studentId,
          branchName: s.members.branchName,
          branchCode: s.members.branchCode,
          cohort: s.members.cohort,
        })
        .from(s.members)
        .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
        .where(eq(s.members.organizationId, organizationId))
        .orderBy(s.user.name)
        .limit(2000)
        .then((rows) =>
          rows.map((row) => ({
            ...row,
            features: supportedFeatures(row.features),
          })),
        ),
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
    if (input.role === "student")
      throw new BadRequestException(
        "Create a student registration and approve it to send their welcome email.",
      );
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
        features: supportedFeatures(record.features),
      };
    });
  }
  async setPassword(
    actor: Actor,
    currentPassword: string,
    newPassword: string,
    headers: Request["headers"],
  ) {
    return this.scope(actor, async (tx) => {
      // An admin email correction may rotate an unfinished account's password.
      // Serialize both the credential and setup flag with that member edit.
      const [member] = await tx
        .select({ id: s.members.id })
        .from(s.members)
        .where(
          and(
            eq(s.members.id, actor.id),
            eq(s.members.authUserId, actor.authId),
          ),
        )
        .for("update");
      if (!member) throw new NotFoundException();
      const auth = createAuth(
        tx as unknown as Database,
        this.config,
        this.local,
      );
      const response = await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: fromNodeHeaders(headers),
        asResponse: true,
      });
      if (!response.ok)
        throw new BadRequestException(
          "Check your current password and use a password with at least 12 characters.",
        );
      await tx
        .update(s.members)
        .set({ passwordSetupComplete: true, updatedAt: new Date() })
        .where(eq(s.members.id, actor.id));
      return response;
    });
  }
  async catalog(actor: Actor, transaction?: Transaction) {
    const read = <T>(work: (tx: Transaction) => Promise<T>) =>
      transaction ? work(transaction) : this.scope(actor, work);
    if (actor.role === "platform_admin")
      return read((tx) => tx.select().from(s.courses).orderBy(s.courses.title));
    this.feature(actor, "courses");
    return read(async (tx) => {
      const ids = actor.access
        ? Object.values(actor.courseVersionIds || {})
        : null;
      if (ids && !ids.length) return [];
      const fields = {
        id: s.courses.id,
        title: s.versions.title,
        description: s.versions.description,
        track: s.courses.track,
        status: s.courses.status,
        versionId: s.versions.id,
        version: s.versions.number,
        coverImageUrl: s.courses.coverImageUrl,
        coverUploadId: s.courses.coverUploadId,
        lastOpenedAt: s.courseActivity.lastOpenedAt,
      };
      const query = tx
        .select(fields)
        .from(s.versions)
        .innerJoin(s.courses, eq(s.versions.courseId, s.courses.id))
        .leftJoin(
          s.courseActivity,
          and(
            eq(s.courseActivity.courseId, s.courses.id),
            eq(s.courseActivity.memberId, actor.id),
          ),
        )
        .where(
          ids
            ? inArray(s.versions.id, ids)
            : inArray(
                s.versions.id,
                tx
                  .select({ id: s.grants.versionId })
                  .from(s.grants)
                  .where(and(eq(s.grants.memberId, actor.id), unexpired())),
              ),
        )
        .orderBy(
          sql`${s.courseActivity.lastOpenedAt} desc nulls last`,
          s.versions.title,
          s.courses.id,
        );
      const courses = await query;
      return resolveCourseCovers(
        this,
        tx,
        courses.map((c) => ({
          ...c,
          lastOpenedAt: c.lastOpenedAt?.toISOString() || null,
        })),
      );
    });
  }
  async createCourse(
    actor: Actor,
    input: {
      title: string;
      description: string;
      track: string;
    } & CourseCoverInput,
  ) {
    return this.scope(actor, async (tx) => {
      await validateCourseCover(tx, input);
      const [course] = await tx.insert(s.courses).values(input).returning();
      await this.log(tx, actor, "course.created", null, course.id);
      return course;
    });
  }
  async updateCourseStatus(
    actor: Actor,
    id: string,
    status: "archived" | "published",
  ) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    return this.scope(actor, async (tx) => {
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, id))
        .for("update");
      if (!course) throw new NotFoundException("Course not found.");
      if (course.status !== "published" && course.status !== "archived")
        throw new ConflictException(
          "Publish this draft before archiving it, or delete the unused draft.",
        );
      if (course.status === status) return course;
      const [updated] = await tx
        .update(s.courses)
        .set({ status, updatedAt: new Date() })
        .where(eq(s.courses.id, id))
        .returning();
      await this.log(
        tx,
        actor,
        status === "archived" ? "course.archived" : "course.restored",
        null,
        id,
      );
      return updated;
    });
  }
  async deleteDraftCourse(actor: Actor, id: string) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    return this.scope(actor, async (tx) => {
      // Publication locks this same row, so a draft cannot be deleted while it
      // becomes a published course. Published history is never cascade-deleted.
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, id))
        .for("update");
      if (!course) throw new NotFoundException("Course not found.");
      if (course.status !== "draft")
        throw new ConflictException(
          "Only unused drafts can be deleted. Archive a published course instead.",
        );
      const [references] = await tx
        .select({
          versions: sql<boolean>`exists(select 1 from ${s.versions} where ${s.versions.courseId} = ${id})`,
          enrollments: sql<boolean>`exists(select 1 from ${s.grants} where ${s.grants.courseId} = ${id})`,
          policies: sql<boolean>`exists(select 1 from ${s.accessPolicies}
            where ${s.accessPolicies.policy}->'courseIds' @> ${JSON.stringify([id])}::jsonb
            or ${s.accessPolicies.courseVersions} ? ${id})`,
        })
        .from(sql`(values (true)) as course_references`);
      if (references.versions || references.enrollments || references.policies)
        throw new ConflictException(
          "This draft has saved course history or access references and cannot be deleted.",
        );
      await tx.delete(s.courses).where(eq(s.courses.id, id));
      await this.log(tx, actor, "course.deleted", null, id);
      return { id, deleted: true as const };
    });
  }
  async course(
    actor: Actor,
    id: string,
    transaction?: Transaction,
    includeAnswerKeys = false,
  ): Promise<Course & { lessons: Lesson[]; completedLessonIds: string[] }> {
    if (actor.role === "student") {
      this.feature(actor, "courses");
      if (actor.access && !actor.access.courseIds.includes(id))
        throw new ForbiddenException(
          "This course has not been assigned to you.",
        );
    }
    const isAdmin = actor.role === "platform_admin";
    const assignedVersion = actor.courseVersionIds?.[id];
    if (!isAdmin && actor.access && !assignedVersion)
      throw new ForbiddenException("This course has not been assigned to you.");
    const read = async (tx: Transaction) => {
      // The assigned version and its completion IDs share the course read.
      // Students retain their pinned version even after a new publication.
      const version = tx
        .select()
        .from(s.versions)
        .where(
          and(
            eq(s.versions.courseId, id),
            isAdmin
              ? undefined
              : actor.access
                ? eq(s.versions.id, assignedVersion!)
                : inArray(
                    s.versions.id,
                    tx
                      .select({ id: s.grants.versionId })
                      .from(s.grants)
                      .where(
                        and(
                          eq(s.grants.memberId, actor.id),
                          eq(s.grants.courseId, id),
                          unexpired(),
                        ),
                      ),
                  ),
          ),
        )
        .orderBy(desc(s.versions.number))
        .limit(1)
        .as("selected_version");
      const [record] = await tx
        .select({
          course: s.courses,
          version: {
            id: version.id,
            title: version.title,
            description: version.description,
            number: version.number,
            lessons: version.lessons,
          },
          completedLessonIds:
            actor.role === "student"
              ? sql<
                  string[]
                >`array(select ${s.progress.lessonId} from ${s.progress} where ${s.progress.memberId} = ${actor.id} and ${s.progress.versionId} = ${version.id})`
              : sql<string[]>`array[]::text[]`,
        })
        .from(s.courses)
        .leftJoin(version, eq(version.courseId, s.courses.id))
        .where(eq(s.courses.id, id));
      if (!record) throw new NotFoundException();
      if (!isAdmin && !record.version)
        throw new ForbiddenException(
          "This course has not been assigned to you.",
        );
      const presentation = isAdmin
        ? record.course
        : (await resolveCourseCovers(this, tx, [record.course]))[0];
      return {
        ...presentation,
        ...(record.version
          ? {
              title: record.version.title,
              description: record.version.description,
              versionId: record.version.id,
              version: record.version.number,
              lessons:
                isAdmin || includeAnswerKeys
                  ? record.version.lessons
                  : record.version.lessons.map(redactLesson),
            }
          : { lessons: [] }),
        completedLessonIds: record.completedLessonIds,
      };
    };
    return transaction ? read(transaction) : this.scope(actor, read);
  }

  async publishCourse(
    actor: Actor,
    id: string,
    input: {
      title: string;
      description: string;
      lessons: PublishLesson[];
    } & CourseCoverInput,
  ) {
    const lessons = input.lessons.map((item) => lessonInput.parse(item));
    return this.scope(actor, async (tx) => {
      await validateCourseCover(tx, input);
      await validateQuestionImages(
        tx,
        lessons.flatMap((lesson) => lesson.quiz?.questions || []),
      );
      const uploadIds = lessons.flatMap((item) =>
        item.kind === "video" && item.video?.uploadId
          ? [item.video.uploadId]
          : [],
      );
      if (uploadIds.length) {
        const uploads = await tx
          .select()
          .from(s.lessonUploads)
          .where(inArray(s.lessonUploads.id, uploadIds));
        if (
          uploadIds.some(
            (id) =>
              !uploads.some(
                (upload) =>
                  upload.id === id &&
                  upload.purpose === "video" &&
                  upload.status === "ready" &&
                  upload.objectKey,
              ),
          )
        )
          throw new BadRequestException(
            "Finish uploading each video before publishing this course.",
          );
      }
      const [course] = await tx
        .select()
        .from(s.courses)
        .where(eq(s.courses.id, id))
        .for("update");
      if (!course) throw new NotFoundException();
      if (course.status === "archived")
        throw new ConflictException(
          "Restore this course before publishing changes.",
        );
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
          lessons: lessons.map((lesson) => ({
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
          ...(input.coverImageUrl !== undefined ||
          input.coverUploadId !== undefined
            ? {
                coverImageUrl: input.coverImageUrl || null,
                coverUploadId: input.coverUploadId || null,
              }
            : {}),
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
        .where(eq(s.members.id, memberId))
        .for("update");
      if (!member || member.role !== "student" || member.status !== "active")
        throw new BadRequestException("Choose an active student.");
      const [course] = await tx
        .select({ status: s.courses.status })
        .from(s.courses)
        .where(eq(s.courses.id, courseId))
        .for("share");
      if (!course || course.status !== "published")
        throw new BadRequestException(
          "Choose a published course. Archived courses cannot receive new assignments.",
        );
      const policies = await tx
        .select()
        .from(s.accessPolicies)
        .where(eq(s.accessPolicies.organizationId, member.organizationId!));
      if (
        policies.some(
          (row) =>
            row.policy.courseIds !== null || row.policy.features !== null,
        )
      )
        throw new BadRequestException(
          "Manage course enrollment from this organization's Access workspace.",
        );
      const [version] = await tx
        .select()
        .from(s.versions)
        .where(eq(s.versions.courseId, courseId))
        .orderBy(desc(s.versions.number))
        .limit(1);
      if (!version)
        throw new BadRequestException(
          "Publish the course before assigning it.",
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
    const lesson = course.lessons.find((item) => item.id === lessonId)!;
    if (lesson.kind === "assignment" || lesson.kind === "quiz")
      throw new BadRequestException(
        "Submit the assignment or pass the MCQ assignment to complete this lesson.",
      );
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
    return this.scope(actor, async (tx) => {
      const jobs = await tx
        .select()
        .from(s.jobs)
        .where(
          eq(s.jobs.organizationId, actor.organizationId || organizationId!),
        )
        .orderBy(desc(s.jobs.postedAt));
      return new JobLogoService(this).resolve(tx, jobs);
    });
  }
  async createJob(
    actor: Actor,
    input: {
      organizationId: string;
      title: string;
      company: string;
      description: string;
      url: string;
      logoId?: string | null;
    },
  ) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    return this.scope(actor, async (tx) => {
      const [organization] = await tx
        .select({ status: s.organizations.status })
        .from(s.organizations)
        .where(eq(s.organizations.id, input.organizationId))
        .for("share");
      if (!organization) throw new NotFoundException("Organization not found.");
      if (organization.status !== "active")
        throw new BadRequestException(
          "Activate the organization before posting a job.",
        );
      await new JobLogoService(this).validate(tx, input.logoId);
      const [job] = await tx.insert(s.jobs).values(input).returning();
      await this.log(tx, actor, "job.published", input.organizationId, job.id);
      return (await new JobLogoService(this).resolve(tx, [job]))[0];
    });
  }
  async createJobForAll(
    actor: Actor,
    input: {
      title: string;
      company: string;
      description: string;
      url: string;
      logoId?: string | null;
    },
  ) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    return this.scope(actor, async (tx) => {
      // Keep each job within the existing tenant boundary. The shared locks
      // prevent an organization from being archived partway through publishing.
      const organizations = await tx
        .select({ id: s.organizations.id })
        .from(s.organizations)
        .where(eq(s.organizations.status, "active"))
        .orderBy(s.organizations.id)
        .for("share");
      if (!organizations.length)
        throw new BadRequestException(
          "Create or activate an organization before posting a job.",
        );
      await new JobLogoService(this).validate(tx, input.logoId);
      const { title, company, description, url, logoId } = input;
      // Bound each insert's parameter count while keeping every batch and its
      // audit records in the same transaction: publication succeeds as a whole.
      for (let offset = 0; offset < organizations.length; offset += 1000) {
        const jobs = await tx
          .insert(s.jobs)
          .values(
            organizations.slice(offset, offset + 1000).map(({ id }) => ({
              organizationId: id,
              title,
              company,
              description,
              url,
              logoId,
            })),
          )
          .returning({ id: s.jobs.id, organizationId: s.jobs.organizationId });
        await tx.insert(s.audit).values(
          jobs.map((job) => ({
            actorId: actor.id,
            action: "job.published",
            organizationId: job.organizationId,
            resourceId: job.id,
          })),
        );
      }
      return {
        publishedCount: organizations.length,
        organizationIds: organizations.map(({ id }) => id),
      };
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
        await lockOrganizationBranches(tx, actor.organizationId!);
        const [organization] = await tx
          .select()
          .from(s.organizations)
          .where(eq(s.organizations.id, actor.organizationId!));
        const roster = await tx
          .select({
            member: s.members,
            name: s.user.name,
            email: s.user.email,
          })
          .from(s.members)
          .innerJoin(s.user, eq(s.members.authUserId, s.user.id))
          .where(
            and(
              eq(s.members.organizationId, actor.organizationId!),
              eq(s.members.role, "student"),
            ),
          );
        const grants = await tx
          .select()
          .from(s.grants)
          .where(eq(s.grants.organizationId, actor.organizationId!));
        const policies = await tx
          .select()
          .from(s.accessPolicies)
          .where(eq(s.accessPolicies.organizationId, actor.organizationId!));
        const assigned = new Map(
          roster.map(({ member }) => [
            member.id,
            resolvePolicies(
              organization,
              member,
              policies,
              grants,
              Boolean(actor.demo),
            ).versionIds,
          ]),
        );
        const versionIds = [
          ...new Set(
            [...assigned.values()].flatMap((pins) => Object.values(pins)),
          ),
        ];
        const versions = versionIds.length
          ? await tx
              .select({ id: s.versions.id, lessons: s.versions.lessons })
              .from(s.versions)
              .where(inArray(s.versions.id, versionIds))
          : [];
        const completed = await tx.select().from(s.progress);
        const students = roster.map(({ member, name, email }) => {
          const own = Object.values(assigned.get(member.id) || {}).flatMap(
            (versionId) => {
              const version = versions.find((item) => item.id === versionId);
              return version ? [{ versionId, lessons: version.lessons }] : [];
            },
          );
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
            name,
            email,
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
