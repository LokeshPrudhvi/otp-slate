import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  CourseCatalogItem,
  CourseEnrollmentInbox,
  CourseEnrollmentRequest,
} from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import {
  normalizedBranch,
  resolvePolicies,
  supportedPolicy,
} from "./access.js";
import { secureUrl } from "./lesson-input.js";
import { encryptPayload } from "./providers.js";
import {
  maxQuestionImageBytes,
  questionImageTypes,
} from "./question-images.js";
import * as s from "./schema.js";

export const courseCoverFields = {
  coverImageUrl: secureUrl.nullable().optional(),
  coverUploadId: z.string().uuid().nullable().optional(),
};
export type CourseCoverInput = {
  coverImageUrl?: string | null;
  coverUploadId?: string | null;
};
export async function validateCourseCover(
  tx: Transaction,
  input: CourseCoverInput,
) {
  if (input.coverImageUrl && input.coverUploadId)
    throw new BadRequestException(
      "Choose an image link or an uploaded cover, not both.",
    );
  if (input.coverImageUrl) secureUrl.parse(input.coverImageUrl);
  if (input.coverUploadId) {
    const [upload] = await tx
      .select()
      .from(s.lessonUploads)
      .where(eq(s.lessonUploads.id, input.coverUploadId));
    if (
      !upload ||
      upload.purpose !== "course_cover" ||
      upload.status !== "ready" ||
      !upload.objectKey ||
      !questionImageTypes.includes(upload.contentType) ||
      upload.size > maxQuestionImageBytes
    )
      throw new BadRequestException(
        "Finish uploading the course cover before saving.",
      );
  }
}
// URLs are signed only for cover IDs present in an already-authorized catalog or course read.
export async function resolveCourseCovers<T extends CourseCoverInput>(
  service: SlateService,
  tx: Transaction,
  courses: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(
      courses.flatMap((c) => (c.coverUploadId ? [c.coverUploadId] : [])),
    ),
  ];
  if (!ids.length) return courses;
  await tx.execute(
    sql`select set_config('slate.course_cover_ids', ${ids.join(",")}, true)`,
  );
  const uploads = await tx
    .select()
    .from(s.lessonUploads)
    .where(inArray(s.lessonUploads.id, ids));
  const urls = new Map<string, string>();
  if (service.lessonStorage.configured())
    await Promise.all(
      uploads
        .filter(
          (u) =>
            u.purpose === "course_cover" && u.status === "ready" && u.objectKey,
        )
        .map(async (u) => {
          urls.set(
            u.id,
            await service.lessonStorage.download(
              u.objectKey!,
              u.fileName,
              false,
            ),
          );
        }),
    );
  return courses.map((course) => ({
    ...course,
    coverImageUrl: course.coverUploadId
      ? urls.get(course.coverUploadId) || null
      : course.coverImageUrl,
  }));
}
export const enrollmentInboxQuery = z
  .object({
    organizationId: z.string().uuid().optional(),
    status: z.enum(["pending", "reviewed"]).optional(),
    unread: z.enum(["1", "0"]).optional(),
    q: z.string().trim().max(150).optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export const enrollmentReviewInput = z
  .object({
    read: z.boolean().optional(),
    status: z.enum(["pending", "reviewed"]).optional(),
  })
  .strict()
  .refine(
    (input) => input.read !== undefined || input.status !== undefined,
    "Choose an update.",
  );

export class CourseCatalogService {
  constructor(readonly service: SlateService) {}
  private student(actor: Actor) {
    if (actor.role !== "student") throw new ForbiddenException();
    this.service.feature(actor, "courses");
  }
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
  }
  private async discovery(
    tx: Transaction,
    actor: Actor,
  ): Promise<CourseCatalogItem[]> {
    const [member] = await tx
      .select()
      .from(s.members)
      .where(eq(s.members.id, actor.id));
    if (!member) throw new ForbiddenException();
    const policies = await tx
      .select()
      .from(s.accessPolicies)
      .where(
        and(
          eq(s.accessPolicies.organizationId, actor.organizationId!),
          or(
            eq(s.accessPolicies.scope, "organization"),
            and(
              eq(s.accessPolicies.scope, "branch"),
              eq(
                s.accessPolicies.targetKey,
                normalizedBranch(member.branchCode) || "",
              ),
            ),
          ),
        ),
      );
    const ceilings = policies
      .map((p) => supportedPolicy(p.policy).courseIds)
      .filter((ids): ids is string[] => ids !== null);
    const allowed = (id: string) => ceilings.every((ids) => ids.includes(id));
    // Assigned versions remain the student's source of truth, including archived
    // courses. Only unassigned discovery is restricted to published metadata.
    const enrolledVersion = alias(s.versions, "enrolled_catalog_version");
    const assignedVersionIds = Object.values(actor.courseVersionIds || {});
    const records = await tx
      .selectDistinctOn([s.courses.id], {
        id: s.courses.id,
        title: sql<string>`coalesce(${enrolledVersion.title}, ${s.versions.title})`,
        description: sql<string>`coalesce(${enrolledVersion.description}, ${s.versions.description})`,
        enrolled: sql<boolean>`${enrolledVersion.id} is not null`,
        track: s.courses.track,
        status: s.courses.status,
        coverImageUrl: s.courses.coverImageUrl,
        coverUploadId: s.courses.coverUploadId,
        lastOpenedAt: s.courseActivity.lastOpenedAt,
        enrollmentRequestStatus: s.enrollmentRequests.status,
      })
      .from(s.courses)
      .innerJoin(s.versions, eq(s.versions.courseId, s.courses.id))
      .leftJoin(
        enrolledVersion,
        and(
          eq(enrolledVersion.courseId, s.courses.id),
          assignedVersionIds.length
            ? inArray(enrolledVersion.id, assignedVersionIds)
            : sql`false`,
        ),
      )
      .leftJoin(
        s.courseActivity,
        and(
          eq(s.courseActivity.courseId, s.courses.id),
          eq(s.courseActivity.memberId, actor.id),
        ),
      )
      .leftJoin(
        s.enrollmentRequests,
        and(
          eq(s.enrollmentRequests.courseId, s.courses.id),
          eq(s.enrollmentRequests.studentMemberId, actor.id),
        ),
      )
      .where(
        or(
          eq(s.courses.status, "published"),
          sql`${enrolledVersion.id} is not null`,
        ),
      )
      .orderBy(s.courses.id, desc(s.versions.number));
    const visible = records
      .filter((row) => row.enrolled || allowed(row.id))
      .map((row) => ({
        ...row,
        lastOpenedAt: row.lastOpenedAt?.toISOString() || null,
      }))
      .sort(
        (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      );
    return resolveCourseCovers(this.service, tx, visible);
  }
  async catalog(actor: Actor) {
    this.student(actor);
    return this.service.scope(actor, (tx) => this.discovery(tx, actor));
  }
  async opened(actor: Actor, id: string) {
    this.student(actor);
    return this.service.scope(actor, async (tx) => {
      await this.service.course(actor, id, tx);
      const lastOpenedAt = new Date();
      await tx
        .insert(s.courseActivity)
        .values({
          organizationId: actor.organizationId!,
          memberId: actor.id,
          courseId: id,
          lastOpenedAt,
        })
        .onConflictDoUpdate({
          target: [s.courseActivity.memberId, s.courseActivity.courseId],
          set: { lastOpenedAt },
        });
      return { lastOpenedAt: lastOpenedAt.toISOString() };
    });
  }
  async request(actor: Actor, courseId: string) {
    this.student(actor);
    return this.service.scope(actor, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${actor.id}),hashtext(${courseId}))`,
      );
      const course = (await this.discovery(tx, actor)).find(
        (c) => c.id === courseId,
      );
      if (!course || course.status !== "published")
        throw new NotFoundException(
          "This course is not available to your organization and branch.",
        );
      if (course.enrolled)
        throw new ConflictException("You already have access to this course.");
      const [existing] = await tx
        .select({
          id: s.enrollmentRequests.id,
          status: s.enrollmentRequests.status,
          createdAt: s.enrollmentRequests.createdAt,
          emailStatus: s.outbox.status,
        })
        .from(s.enrollmentRequests)
        .innerJoin(s.outbox, eq(s.outbox.id, s.enrollmentRequests.outboxId))
        .where(
          and(
            eq(s.enrollmentRequests.studentMemberId, actor.id),
            eq(s.enrollmentRequests.courseId, courseId),
          ),
        );
      if (existing)
        return { ...existing, createdAt: existing.createdAt.toISOString() };
      const [member] = await tx
        .select()
        .from(s.members)
        .where(eq(s.members.id, actor.id));
      const requestId = randomUUID(),
        outboxId = randomUUID(),
        createdAt = new Date();
      const recipient = z
        .email()
        .parse(
          process.env.ENROLLMENT_REQUEST_EMAIL?.trim() ||
            "prudhvilokesh789@gmail.com",
        );
      const fields = {
        studentName: actor.name,
        studentEmail: actor.email,
        studentId: member.studentId,
        organizationName: actor.organizationName!,
        branchName: member.branchName,
        branchCode: member.branchCode,
        courseTitle: course.title,
      };
      await tx.insert(s.outbox).values({
        id: outboxId,
        type: "enrollment_request",
        encryptedPayload: encryptPayload(this.service.config.secret, {
          email: recipient,
          ...fields,
          requestId,
          requestedAt: createdAt.toISOString(),
        }),
        expiresAt: new Date(Date.now() + 7 * 86400_000),
      });
      await tx.insert(s.enrollmentRequests).values({
        id: requestId,
        organizationId: actor.organizationId!,
        studentMemberId: actor.id,
        courseId,
        ...fields,
        outboxId,
        createdAt,
      });
      await this.service.log(
        tx,
        actor,
        "course.enrollment_requested",
        actor.organizationId,
        requestId,
      );
      return {
        id: requestId,
        status: "pending" as const,
        createdAt: createdAt.toISOString(),
        emailStatus: "pending",
      };
    });
  }
  private async rows(
    tx: Transaction,
    records: (typeof s.enrollmentRequests.$inferSelect & {
      emailStatus: string;
    })[],
  ): Promise<CourseEnrollmentRequest[]> {
    if (!records.length) return [];
    const orgIds = [...new Set(records.map((r) => r.organizationId))],
      memberIds = [...new Set(records.map((r) => r.studentMemberId))];
    const [orgs, members, policies, grants] = await Promise.all([
      tx
        .select()
        .from(s.organizations)
        .where(inArray(s.organizations.id, orgIds)),
      tx.select().from(s.members).where(inArray(s.members.id, memberIds)),
      tx
        .select()
        .from(s.accessPolicies)
        .where(inArray(s.accessPolicies.organizationId, orgIds)),
      tx.select().from(s.grants).where(inArray(s.grants.memberId, memberIds)),
    ]);
    return records.map((r) => {
      const org = orgs.find((o) => o.id === r.organizationId),
        member = members.find((m) => m.id === r.studentMemberId);
      const enrolled = Boolean(
        org &&
        member &&
        resolvePolicies(
          org,
          member,
          policies.filter((p) => p.organizationId === org.id),
          grants,
          false,
        ).effective.courseIds.includes(r.courseId),
      );
      const { outboxId, reviewedBy, ...publicRow } = r;
      return {
        ...publicRow,
        enrolled,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt?.toISOString() || null,
        reviewedAt: r.reviewedAt?.toISOString() || null,
      };
    });
  }
  async inbox(
    actor: Actor,
    query: z.infer<typeof enrollmentInboxQuery>,
  ): Promise<CourseEnrollmentInbox> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const search = query.q?.replace(/[\\%_]/g, "\\$&");
      const where = and(
        query.organizationId
          ? eq(s.enrollmentRequests.organizationId, query.organizationId)
          : undefined,
        query.status
          ? eq(s.enrollmentRequests.status, query.status)
          : undefined,
        query.unread === "1" ? isNull(s.enrollmentRequests.readAt) : undefined,
        search
          ? or(
              ilike(s.enrollmentRequests.studentName, `%${search}%`),
              ilike(s.enrollmentRequests.studentEmail, `%${search}%`),
              ilike(s.enrollmentRequests.courseTitle, `%${search}%`),
              ilike(s.enrollmentRequests.studentId, `%${search}%`),
            )
          : undefined,
      );
      const records = await tx
        .select({ request: s.enrollmentRequests, emailStatus: s.outbox.status })
        .from(s.enrollmentRequests)
        .innerJoin(s.outbox, eq(s.outbox.id, s.enrollmentRequests.outboxId))
        .where(where)
        .orderBy(
          desc(s.enrollmentRequests.createdAt),
          desc(s.enrollmentRequests.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [total] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.enrollmentRequests)
        .where(where);
      const [unread] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(s.enrollmentRequests)
        .where(isNull(s.enrollmentRequests.readAt));
      return {
        items: await this.rows(
          tx,
          records.map((r) => ({ ...r.request, emailStatus: r.emailStatus })),
        ),
        total: total.count,
        unreadCount: unread.count,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  async review(
    actor: Actor,
    id: string,
    input: z.infer<typeof enrollmentReviewInput>,
  ) {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const [row] = await tx
        .update(s.enrollmentRequests)
        .set({
          ...(input.read !== undefined
            ? { readAt: input.read ? new Date() : null }
            : {}),
          ...(input.status
            ? {
                status: input.status,
                reviewedAt: input.status === "reviewed" ? new Date() : null,
                reviewedBy: input.status === "reviewed" ? actor.id : null,
                ...(input.status === "reviewed" ? { readAt: new Date() } : {}),
              }
            : {}),
        })
        .where(eq(s.enrollmentRequests.id, id))
        .returning();
      if (!row) throw new NotFoundException("Enrollment request not found.");
      const [mail] = await tx
        .select({ status: s.outbox.status })
        .from(s.outbox)
        .where(eq(s.outbox.id, row.outboxId));
      await this.service.log(
        tx,
        actor,
        "course.enrollment_request_reviewed",
        row.organizationId,
        row.id,
      );
      return (await this.rows(tx, [{ ...row, emailStatus: mail.status }]))[0];
    });
  }
}
