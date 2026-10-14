import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  examLanguages,
  type AdminExam,
  type AdminExamAttempt,
  type ExamAdminSummary,
  type ExamAnswer,
  type ExamAttemptView,
  type ExamAudienceOptions,
  type ExamDraft,
  type ExamMonitorEvent,
  type ExamQuestion,
  type ExamResult,
  type ExamResults,
  type StudentExamDetail,
  type StudentExamQuestion,
  type StudentExamSummary,
} from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import { lockOrganizationBranches, branchCodeInput } from "./branches.js";
import { resolvePolicies } from "./access.js";
import * as s from "./schema.js";
import {
  questionImageInput,
  validateQuestionImages,
} from "./question-images.js";
import { LessonService } from "./lessons.js";

const text = (max: number) => z.string().trim().min(1).max(max);
const key = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,80}$/, "Use a simple unique question or test ID.");
const language = z.enum(
  examLanguages as [
    (typeof examLanguages)[number],
    ...(typeof examLanguages)[number][],
  ],
);
const sourceCode = z.string().max(30000);
const baseQuestion = {
  id: key,
  title: text(200),
  prompt: text(20000),
  points: z.number().int().min(1).max(1000),
};
const question = z.discriminatedUnion("kind", [
  z
    .object({
      ...baseQuestion,
      kind: z.literal("mcq"),
      image: questionImageInput.optional(),
      options: z.array(text(2000)).min(2).max(8),
      correctOption: z.number().int().min(0).max(7),
      explanation: z.string().max(5000),
    })
    .strict(),
  z
    .object({
      ...baseQuestion,
      kind: z.literal("coding"),
      languages: z.array(language).min(1).max(12),
      starterCode: z.partialRecord(language, sourceCode),
      testCases: z
        .array(
          z
            .object({
              id: key,
              input: z.string().max(10000),
              output: z.string().max(10000),
              hidden: z.boolean(),
            })
            .strict(),
        )
        .max(10)
        .default([]),
    })
    .strict(),
]);
const branchAudienceInput = z
  .object({
    mode: z.enum(["branches", "students"]),
    branchCodes: z
      .array(branchCodeInput)
      .length(1, "Choose exactly one branch in the selected organization."),
    studentIds: z.array(z.uuid()).max(10000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.mode === "branches" && value.studentIds.length > 0) ||
      (value.mode === "students" && value.studentIds.length === 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choose all students in the branch or select specific students.",
      });
    if (new Set(value.studentIds).size !== value.studentIds.length)
      ctx.addIssue({
        code: "custom",
        message: "Remove duplicate student selections.",
      });
  });
export const examDraftInput = z
  .object({
    codingGrading: z.literal("manual"),
    organizationId: z.uuid(),
    title: text(150),
    description: z.string().max(2000),
    instructions: z.string().max(10000),
    audience: branchAudienceInput,
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(1).max(480),
    passingPercentage: z.number().int().min(0).max(100),
    monitoring: z
      .object({
        enabled: z.boolean(),
        requireFullscreen: z.boolean(),
        recordClipboard: z.boolean(),
      })
      .strict(),
    questions: z.array(question).min(1).max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (new Date(value.endsAt) <= new Date(value.startsAt))
      issue("Exam end must be after its start.");
    if (
      new Set(value.questions.map((q) => q.id)).size !== value.questions.length
    )
      issue("Question IDs must be unique.");
    if (value.questions.filter((q) => q.kind === "coding").length > 10)
      issue("Use no more than 10 coding questions per exam.");
    for (const q of value.questions) {
      if (q.kind === "mcq" && q.correctOption >= q.options.length)
        issue("Choose a valid correct option for every MCQ.");
      if (q.kind === "mcq" && new Set(q.options).size !== q.options.length)
        issue("MCQ options must be distinct.");
      if (q.kind === "coding") {
        if (
          new Set(q.languages).size !== q.languages.length ||
          Object.keys(q.starterCode).some(
            (l) => !q.languages.includes(l as (typeof q.languages)[number]),
          )
        )
          issue("Starter code must use the question's selected languages.");
        if (new Set(q.testCases.map((c) => c.id)).size !== q.testCases.length)
          issue("Test case IDs must be unique within each question.");
      }
    }
  });
export const createExamInput = examDraftInput.safeExtend({
  clientId: z.uuid(),
});
export const updateExamInput = examDraftInput.safeExtend({
  revision: z.number().int().min(1),
});
export const examRevisionInput = z
  .object({ revision: z.number().int().min(1) })
  .strict();
const answerInput = z
  .object({
    questionId: key,
    selectedOption: z.number().int().min(0).max(7).nullable().optional(),
    language: language.optional(),
    code: sourceCode.optional(),
  })
  .strict();
export const examAnswersInput = z
  .object({
    revision: z.number().int().min(0),
    answers: z.array(answerInput).max(50),
  })
  .strict();
export const examEventsInput = z
  .object({
    events: z
      .array(
        z
          .object({
            id: z.uuid(),
            type: z.enum([
              "tab_hidden",
              "window_blur",
              "fullscreen_exit",
              "copy",
              "paste",
              "cut",
              "offline",
              "online",
            ]),
            occurredAt: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export const manualExamGradeInput = z
  .object({
    revision: z.number().int().min(0),
    scores: z
      .array(
        z
          .object({
            questionId: key,
            points: z.number().min(0).max(1000),
            feedback: z.string().max(5000),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();
type ExamRow = typeof s.liveExams.$inferSelect;
type AttemptRow = typeof s.liveExamAttempts.$inferSelect;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const total = (questions: { points: number }[]) =>
  questions.reduce((n, q) => n + q.points, 0);
export function redactExamQuestions(
  questions: ExamQuestion[],
): StudentExamQuestion[] {
  return questions.map((q) =>
    q.kind === "mcq"
      ? {
          id: q.id,
          kind: q.kind,
          title: q.title,
          prompt: q.prompt,
          points: q.points,
          options: q.options,
          ...(q.image ? { image: q.image } : {}),
        }
      : { ...q, testCases: q.testCases.filter((t) => !t.hidden) },
  );
}
function validateAnswers(
  questions: StudentExamQuestion[],
  answers: ExamAnswer[],
) {
  if (new Set(answers.map((a) => a.questionId)).size !== answers.length)
    throw new BadRequestException("Submit one answer per question.");
  for (const a of answers) {
    const q = questions.find((q) => q.id === a.questionId);
    if (!q)
      throw new BadRequestException("This question is not part of the exam.");
    if (
      q.kind === "mcq" &&
      (a.language !== undefined ||
        a.code !== undefined ||
        (a.selectedOption != null && a.selectedOption >= q.options.length))
    )
      throw new BadRequestException("Choose a valid MCQ option.");
    if (
      q.kind === "coding" &&
      (a.selectedOption !== undefined ||
        (a.language !== undefined && !q.languages.includes(a.language)))
    )
      throw new BadRequestException(
        "Choose an allowed language for this coding answer.",
      );
  }
}
export class ExamService {
  constructor(private readonly service: SlateService) {}
  capabilities(actor: Actor) {
    this.admin(actor);
    return {
      codingExecutionConfigured: false,
      codingGrading: "manual" as const,
      provider: null,
    };
  }
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException(
        "Only Platform Admin can manage live exams.",
      );
  }
  private student(actor: Actor) {
    if (actor.role !== "student")
      throw new ForbiddenException("Use a student account for live exams.");
    this.service.feature(actor, "live-exams");
  }
  private async organization(tx: Transaction, id: string, lock = false) {
    const query = tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, id));
    const [org] = lock ? await query.for("share") : await query;
    if (!org) throw new NotFoundException("Organization not found.");
    return org;
  }
  private active(org: typeof s.organizations.$inferSelect) {
    if (org.status !== "active")
      throw new BadRequestException(
        "Activate the organization before managing its exams.",
      );
  }
  private async row(tx: Transaction, id: string, lock = false) {
    const query = tx.select().from(s.liveExams).where(eq(s.liveExams.id, id));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw new NotFoundException("Exam not found.");
    return row;
  }
  private revision(row: ExamRow, revision: number) {
    if (row.revision !== revision)
      throw new ConflictException(
        "This exam changed in another session. Reload it before saving.",
      );
  }
  private phase(row: ExamRow) {
    const now = Date.now();
    return now < row.startsAt.getTime()
      ? "upcoming"
      : now >= row.endsAt.getTime()
        ? "ended"
        : "live";
  }
  private async examLock(tx: Transaction, id: string, exclusive = false) {
    const key = `slate:live-exam:${id}`;
    await tx.execute(
      exclusive
        ? sql`select pg_advisory_xact_lock(hashtextextended(${key},0))`
        : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key},0))`,
    );
  }
  private async currentStudent(tx: Transaction, actor: Actor) {
    if (actor.organizationId)
      await lockOrganizationBranches(tx, actor.organizationId);
    const [member] = await tx
      .select()
      .from(s.members)
      .where(
        and(
          eq(s.members.id, actor.id),
          eq(s.members.authUserId, actor.authId),
          eq(s.members.role, "student"),
          eq(s.members.status, "active"),
        ),
      );
    if (
      !member ||
      member.organizationId !== actor.organizationId ||
      !member.organizationId
    )
      throw new ForbiddenException("Student account is no longer active.");
    const org = await this.organization(tx, member.organizationId);
    this.active(org);
    const policies = await tx
      .select()
      .from(s.accessPolicies)
      .where(eq(s.accessPolicies.organizationId, org.id));
    if (
      !resolvePolicies(
        org,
        member,
        policies,
        [],
        false,
      ).effective.features.includes("live-exams")
    )
      throw new ForbiddenException(
        "Platform Admin has not assigned live exams.",
      );
    return member;
  }
  async audience(
    actor: Actor,
    organizationId: string,
  ): Promise<ExamAudienceOptions> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      await lockOrganizationBranches(tx, organizationId);
      const org = await this.organization(tx, organizationId);
      const branches = await tx
        .select()
        .from(s.organizationBranches)
        .where(eq(s.organizationBranches.organizationId, organizationId));
      const people = await tx
        .select({ member: s.members, name: s.user.name, email: s.user.email })
        .from(s.members)
        .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
        .where(
          and(
            eq(s.members.organizationId, organizationId),
            eq(s.members.role, "student"),
            eq(s.members.status, "active"),
          ),
        );
      return {
        organizationId,
        organizationName: org.name,
        status: org.status as "active" | "archived",
        branches: branches.map((b) => ({
          code: b.code,
          name: b.name,
          studentCount: people.filter((p) => p.member.branchCode === b.code)
            .length,
        })),
        students: people.map((p) => ({
          id: p.member.id,
          name: p.name,
          email: p.email,
          studentId: p.member.studentId,
          branchCode: p.member.branchCode,
          branchName: p.member.branchName,
        })),
      };
    });
  }
  private async recipients(
    tx: Transaction,
    org: typeof s.organizations.$inferSelect,
    input: ExamDraft["audience"],
  ) {
    // Legacy published exams retain their frozen rosters. Draft creation,
    // editing and publication always require a single organization branch.
    const parsed = branchAudienceInput.safeParse(input);
    if (!parsed.success)
      throw new BadRequestException(
        "Choose exactly one branch in this organization before saving or publishing the exam.",
      );
    const selection = parsed.data;
    const branchCode = selection.branchCodes[0];
    const branches = await tx
      .select()
      .from(s.organizationBranches)
      .where(eq(s.organizationBranches.organizationId, org.id));
    if (!branches.some((branch) => branch.code === branchCode))
      throw new BadRequestException(
        "Choose a branch belonging to this organization.",
      );
    const people = await tx
      .select({ member: s.members, name: s.user.name, email: s.user.email })
      .from(s.members)
      .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
      .where(
        and(
          eq(s.members.organizationId, org.id),
          eq(s.members.branchCode, branchCode),
          eq(s.members.role, "student"),
          eq(s.members.status, "active"),
        ),
      );
    if (
      selection.studentIds.some((id) => !people.some((p) => p.member.id === id))
    )
      throw new BadRequestException(
        "Choose active students belonging to this organization and selected branch.",
      );
    const policies = await tx
      .select()
      .from(s.accessPolicies)
      .where(eq(s.accessPolicies.organizationId, org.id));
    return people.filter(
      (p) =>
        (selection.mode === "branches" ||
          selection.studentIds.includes(p.member.id)) &&
        resolvePolicies(
          org,
          p.member,
          policies,
          [],
          false,
        ).effective.features.includes("live-exams"),
    );
  }
  private async summaries(
    tx: Transaction,
    rows: ExamRow[],
  ): Promise<ExamAdminSummary[]> {
    if (!rows.length) return [];
    const metadata = await tx
      .select({
        id: s.liveExams.id,
        organizationName: s.organizations.name,
        attempted: sql<number>`(select count(*)::integer from live_exam_attempts a where a.exam_id=${s.liveExams.id})`,
        submitted: sql<number>`(select count(*)::integer from live_exam_attempts a where a.exam_id=${s.liveExams.id} and a.status<>'in_progress')`,
        audience: sql<number>`(select count(*)::integer from live_exam_roster r where r.exam_id=${s.liveExams.id})`,
      })
      .from(s.liveExams)
      .innerJoin(
        s.organizations,
        eq(s.organizations.id, s.liveExams.organizationId),
      )
      .where(
        inArray(
          s.liveExams.id,
          rows.map((r) => r.id),
        ),
      );
    const byId = new Map(metadata.map((m) => [m.id, m]));
    return rows.map((row) => {
      const m = byId.get(row.id)!;
      return {
        id: row.id,
        organizationId: row.organizationId,
        organizationName: m.organizationName,
        title: row.title,
        description: row.description,
        codingGrading: "manual" as const,
        status: row.status as ExamAdminSummary["status"],
        phase: this.phase(row),
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        durationMinutes: row.durationMinutes,
        questionCount: row.publicQuestions.length,
        totalPoints: total(row.publicQuestions),
        audienceCount: m.audience,
        attemptedCount: m.attempted,
        submittedCount: m.submitted,
        revision: row.revision,
        resultsReleasedAt: iso(row.resultsReleasedAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }
  private async summary(
    tx: Transaction,
    row: ExamRow,
  ): Promise<ExamAdminSummary> {
    return (await this.summaries(tx, [row]))[0];
  }
  private async adminView(tx: Transaction, row: ExamRow): Promise<AdminExam> {
    const [key] = await tx
      .select()
      .from(s.liveExamQuestions)
      .where(eq(s.liveExamQuestions.examId, row.id));
    return {
      ...(await this.summary(tx, row)),
      instructions: row.instructions,
      passingPercentage: row.passingPercentage,
      monitoring: row.monitoring,
      audience: row.audience,
      questions: key?.questions || [],
    };
  }
  async list(
    actor: Actor,
    organizationId?: string,
  ): Promise<ExamAdminSummary[]> {
    this.admin(actor);
    await this.finalizeExpired(actor, undefined, organizationId);
    return this.service.scope(actor, async (tx) => {
      const rows = await tx
        .select()
        .from(s.liveExams)
        .where(
          organizationId
            ? eq(s.liveExams.organizationId, organizationId)
            : undefined,
        )
        .orderBy(desc(s.liveExams.createdAt))
        .limit(200);
      return this.summaries(tx, rows);
    });
  }
  async detail(actor: Actor, id: string): Promise<AdminExam> {
    this.admin(actor);
    await this.finalizeExpired(actor, id);
    return this.service.scope(actor, async (tx) =>
      this.adminView(tx, await this.row(tx, id)),
    );
  }
  private draftValues(input: ExamDraft) {
    return {
      codingGrading: input.codingGrading,
      organizationId: input.organizationId,
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      durationMinutes: input.durationMinutes,
      passingPercentage: input.passingPercentage,
      monitoring: input.monitoring,
      audience: input.audience,
      publicQuestions: redactExamQuestions(input.questions),
    };
  }
  async create(
    actor: Actor,
    supplied: ExamDraft & { clientId: string },
  ): Promise<AdminExam> {
    this.admin(actor);
    const input = createExamInput.parse(supplied);
    return this.service.scope(actor, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`slate:exam-create:${input.clientId}`},0))`,
      );
      const [existing] = await tx
        .select()
        .from(s.liveExams)
        .where(eq(s.liveExams.clientId, input.clientId));
      if (existing) {
        if (
          existing.createdBy !== actor.id ||
          existing.organizationId !== input.organizationId
        )
          throw new ConflictException(
            "This create request has already been used.",
          );
        return this.adminView(tx, existing);
      }
      await lockOrganizationBranches(tx, input.organizationId);
      const org = await this.organization(tx, input.organizationId, true);
      this.active(org);
      await this.recipients(tx, org, input.audience);
      await validateQuestionImages(
        tx,
        input.questions.filter((q) => q.kind === "mcq"),
      );
      const [row] = await tx
        .insert(s.liveExams)
        .values({
          ...this.draftValues(input),
          clientId: input.clientId,
          createdBy: actor.id,
        })
        .returning();
      await tx.insert(s.liveExamQuestions).values({
        examId: row.id,
        organizationId: row.organizationId,
        questions: input.questions,
      });
      await this.service.log(
        tx,
        actor,
        "exam.created",
        row.organizationId,
        row.id,
      );
      return this.adminView(tx, row);
    });
  }
  async update(
    actor: Actor,
    id: string,
    supplied: ExamDraft & { revision: number },
  ): Promise<AdminExam> {
    this.admin(actor);
    const input = updateExamInput.parse(supplied);
    return this.service.scope(actor, async (tx) => {
      const reference = await this.row(tx, id);
      if (reference.organizationId !== input.organizationId)
        throw new BadRequestException(
          "An exam cannot be moved to another organization.",
        );
      await lockOrganizationBranches(tx, input.organizationId);
      const org = await this.organization(tx, input.organizationId, true);
      this.active(org);
      await this.examLock(tx, id, true);
      const current = await this.row(tx, id, true);
      this.revision(current, input.revision);
      if (current.status !== "draft")
        throw new ConflictException(
          "Published exam questions, timing and audience cannot be edited. Create a new draft instead.",
        );
      await this.recipients(tx, org, input.audience);
      await validateQuestionImages(
        tx,
        input.questions.filter((q) => q.kind === "mcq"),
      );
      const [row] = await tx
        .update(s.liveExams)
        .set({
          ...this.draftValues(input),
          revision: current.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.liveExams.id, id))
        .returning();
      await tx
        .update(s.liveExamQuestions)
        .set({ questions: input.questions })
        .where(eq(s.liveExamQuestions.examId, id));
      await this.service.log(tx, actor, "exam.updated", row.organizationId, id);
      return this.adminView(tx, row);
    });
  }
  async publish(
    actor: Actor,
    id: string,
    revision: number,
  ): Promise<AdminExam> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const reference = await this.row(tx, id);
      await lockOrganizationBranches(tx, reference.organizationId);
      const org = await this.organization(tx, reference.organizationId, true);
      this.active(org);
      await this.examLock(tx, id, true);
      const current = await this.row(tx, id, true);
      this.revision(current, revision);
      if (current.status !== "draft")
        throw new ConflictException("Only draft exams can be published.");
      if (
        current.startsAt.getTime() < Date.now() ||
        current.endsAt.getTime() <= Date.now()
      )
        throw new BadRequestException(
          "Choose a future exam start and end before publishing.",
        );
      const [key] = await tx
        .select()
        .from(s.liveExamQuestions)
        .where(eq(s.liveExamQuestions.examId, id));
      if (!key) throw new BadRequestException("Add exam questions first.");
      await validateQuestionImages(
        tx,
        key.questions.filter((q) => q.kind === "mcq"),
      );
      const recipients = await this.recipients(tx, org, current.audience);
      if (!recipients.length)
        throw new BadRequestException(
          "No active selected students have live-exam access. Assign access before publishing.",
        );
      for (let i = 0; i < recipients.length; i += 250)
        await tx.insert(s.liveExamRoster).values(
          recipients.slice(i, i + 250).map((p) => ({
            examId: id,
            organizationId: org.id,
            memberId: p.member.id,
            name: p.name,
            email: p.email,
            studentId: p.member.studentId,
            branchCode: p.member.branchCode,
            branchName: p.member.branchName,
          })),
        );
      const [row] = await tx
        .update(s.liveExams)
        .set({
          status: "published",
          codingGrading: "manual",
          revision: current.revision + 1,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(s.liveExams.id, id))
        .returning();
      await this.service.log(
        tx,
        actor,
        "exam.published",
        row.organizationId,
        id,
      );
      return this.adminView(tx, row);
    });
  }
  async cancel(actor: Actor, id: string, revision: number): Promise<AdminExam> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const reference = await this.row(tx, id);
      const org = await this.organization(tx, reference.organizationId, true);
      this.active(org);
      await this.examLock(tx, id, true);
      const current = await this.row(tx, id, true);
      this.revision(current, revision);
      if (current.status === "cancelled") return this.adminView(tx, current);
      if (current.resultsReleasedAt)
        throw new ConflictException("Results have already been released.");
      const now = new Date();
      await tx
        .update(s.liveExamAttempts)
        .set({
          status: "submitted",
          submittedAt: now,
          version: sql`${s.liveExamAttempts.version}+1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(s.liveExamAttempts.examId, id),
            eq(s.liveExamAttempts.status, "in_progress"),
          ),
        );
      const [row] = await tx
        .update(s.liveExams)
        .set({
          status: "cancelled",
          revision: current.revision + 1,
          updatedAt: now,
        })
        .where(eq(s.liveExams.id, id))
        .returning();
      await this.service.log(
        tx,
        actor,
        "exam.cancelled",
        row.organizationId,
        id,
      );
      return this.adminView(tx, row);
    });
  }
  private studentSummary(
    row: ExamRow,
    attempt?: AttemptRow,
  ): StudentExamSummary {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      durationMinutes: row.durationMinutes,
      questionCount: row.publicQuestions.length,
      totalPoints: total(row.publicQuestions),
      state: row.status === "cancelled" ? "cancelled" : this.phase(row),
      attemptId: attempt?.id || null,
      attemptStatus:
        (attempt?.status as StudentExamSummary["attemptStatus"]) || null,
      resultsReleased: !!row.resultsReleasedAt,
      percentage: row.resultsReleasedAt
        ? (attempt?.result?.percentage ?? null)
        : null,
    };
  }
  private studentDetail(row: ExamRow, attempt?: AttemptRow): StudentExamDetail {
    return {
      ...this.studentSummary(row, attempt),
      instructions: row.instructions,
      codingGrading: "manual" as const,
      passingPercentage: row.passingPercentage,
      monitoring: row.monitoring,
      serverNow: new Date().toISOString(),
    };
  }
  async studentList(actor: Actor): Promise<StudentExamSummary[]> {
    this.student(actor);
    await this.finalizeExpired(actor);
    return this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const rows = await tx
        .select()
        .from(s.liveExams)
        .orderBy(desc(s.liveExams.startsAt))
        .limit(200);
      const attempts = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(eq(s.liveExamAttempts.memberId, actor.id));
      return rows.map((row) =>
        this.studentSummary(
          row,
          attempts.find((a) => a.examId === row.id),
        ),
      );
    });
  }
  async studentExam(actor: Actor, id: string): Promise<StudentExamDetail> {
    this.student(actor);
    await this.finalizeExpired(actor, id);
    return this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const row = await this.row(tx, id);
      const [attempt] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.examId, id),
            eq(s.liveExamAttempts.memberId, actor.id),
          ),
        );
      return this.studentDetail(row, attempt);
    });
  }
  async start(actor: Actor, id: string): Promise<ExamAttemptView> {
    this.student(actor);
    const attemptId = await this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`slate:exam-start:${id}:${actor.id}`},0))`,
      );
      await this.examLock(tx, id);
      const row = await this.row(tx, id);
      const now = new Date();
      const [existing] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.examId, id),
            eq(s.liveExamAttempts.memberId, actor.id),
          ),
        );
      if (existing) return existing.id;
      if (row.status !== "published" || now < row.startsAt || now >= row.endsAt)
        throw new ConflictException("This exam is not open for a new attempt.");
      const [roster] = await tx
        .select()
        .from(s.liveExamRoster)
        .where(
          and(
            eq(s.liveExamRoster.examId, id),
            eq(s.liveExamRoster.memberId, actor.id),
          ),
        );
      if (!roster)
        throw new ForbiddenException("This exam is not assigned to you.");
      const [created] = await tx
        .insert(s.liveExamAttempts)
        .values({
          examId: id,
          organizationId: row.organizationId,
          memberId: actor.id,
          startedAt: now,
          deadlineAt: new Date(
            Math.min(
              now.getTime() + row.durationMinutes * 60000,
              row.endsAt.getTime(),
            ),
          ),
        })
        .returning();
      return created.id;
    });
    return this.attempt(actor, attemptId);
  }
  private async ownedAttempt(
    tx: Transaction,
    actor: Actor,
    id: string,
    lock = false,
  ) {
    if (lock) {
      const [reference] = await tx
        .select({ examId: s.liveExamAttempts.examId })
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.id, id),
            eq(s.liveExamAttempts.memberId, actor.id),
          ),
        );
      if (!reference) throw new NotFoundException("Exam attempt not found.");
      await this.examLock(tx, reference.examId);
    }
    const query = tx
      .select()
      .from(s.liveExamAttempts)
      .where(
        and(
          eq(s.liveExamAttempts.id, id),
          eq(s.liveExamAttempts.memberId, actor.id),
        ),
      );
    const [attempt] = lock ? await query.for("update") : await query;
    if (!attempt) throw new NotFoundException("Exam attempt not found.");
    return attempt;
  }
  private async view(
    tx: Transaction,
    row: ExamRow,
    attempt: AttemptRow,
  ): Promise<ExamAttemptView> {
    const [events] = await tx
      .select({ value: count() })
      .from(s.liveExamEvents)
      .where(eq(s.liveExamEvents.attemptId, attempt.id));
    return {
      id: attempt.id,
      examId: row.id,
      exam: this.studentDetail(row, attempt),
      status: attempt.status as ExamAttemptView["status"],
      revision: attempt.version,
      serverNow: new Date().toISOString(),
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt.toISOString(),
      submittedAt: iso(attempt.submittedAt),
      answers: attempt.answers,
      questions: row.publicQuestions,
      eventCount: events.value,
      result: row.resultsReleasedAt ? attempt.result : null,
    };
  }
  async attempt(actor: Actor, id: string): Promise<ExamAttemptView> {
    this.student(actor);
    const examId = await this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      return (await this.ownedAttempt(tx, actor, id)).examId;
    });
    await this.finalizeExpired(actor, examId);
    await this.grade(actor, id);
    return this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const attempt = await this.ownedAttempt(tx, actor, id);
      return this.view(tx, await this.row(tx, attempt.examId), attempt);
    });
  }
  async questionImage(actor: Actor, attemptId: string, uploadId: string) {
    this.student(actor);
    await this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const attempt = await this.ownedAttempt(tx, actor, attemptId);
      const exam = await this.row(tx, attempt.examId);
      if (
        exam.status !== "published" ||
        !exam.publicQuestions.some(
          (q) => q.kind === "mcq" && q.image?.uploadId === uploadId,
        )
      )
        throw new NotFoundException(
          "This attempt has no matching question image.",
        );
    });
    return new LessonService(
      this.service,
      this.service.lessonStorage,
    ).authorizedQuestionImage(actor, uploadId);
  }
  async save(
    actor: Actor,
    id: string,
    supplied: z.infer<typeof examAnswersInput>,
    submit = false,
  ): Promise<ExamAttemptView> {
    this.student(actor);
    const input = examAnswersInput.parse(supplied);
    await this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const attempt = await this.ownedAttempt(tx, actor, id, true);
      const row = await this.row(tx, attempt.examId);
      const now = new Date();
      if (attempt.status !== "in_progress") {
        if (submit) return;
        throw new ConflictException("This attempt has already been submitted.");
      }
      if (now >= attempt.deadlineAt || row.status !== "published") {
        await tx
          .update(s.liveExamAttempts)
          .set({
            status: "submitted",
            submittedAt: attempt.deadlineAt < now ? attempt.deadlineAt : now,
            version: attempt.version + 1,
            updatedAt: now,
          })
          .where(eq(s.liveExamAttempts.id, id));
        return;
      }
      if (attempt.version !== input.revision)
        throw new ConflictException(
          "Answers changed in another tab or session. Reload this attempt before continuing.",
        );
      if (
        !submit &&
        attempt.version > 0 &&
        now.getTime() - attempt.updatedAt.getTime() < 500
      )
        throw new HttpException(
          "Please wait briefly before saving again.",
          429,
        );
      validateAnswers(row.publicQuestions, input.answers);
      await tx
        .update(s.liveExamAttempts)
        .set({
          answers: input.answers,
          version: attempt.version + 1,
          updatedAt: now,
          ...(submit ? { status: "submitted", submittedAt: now } : {}),
        })
        .where(eq(s.liveExamAttempts.id, id));
    });
    return this.attempt(actor, id);
  }
  async events(
    actor: Actor,
    id: string,
    supplied: { events: ExamMonitorEvent[] },
  ) {
    this.student(actor);
    const input = examEventsInput.parse(supplied);
    return this.service.scope(actor, async (tx) => {
      await this.currentStudent(tx, actor);
      const attempt = await this.ownedAttempt(tx, actor, id, true);
      const exam = await this.row(tx, attempt.examId);
      const now = Date.now();
      const windowEnd = Math.min(
        attempt.deadlineAt.getTime(),
        attempt.submittedAt?.getTime() ?? attempt.deadlineAt.getTime(),
      );
      // A final browser batch can arrive just after autosubmission or a reconnect.
      // Its client timestamp remains an untrusted signal; the server bounds both
      // the claimed occurrence window and the time at which it receives the batch.
      if (
        !exam.monitoring.enabled ||
        exam.status !== "published" ||
        now > windowEnd + 60_000
      )
        return { accepted: 0 };
      const [amount] = await tx
        .select({ value: count() })
        .from(s.liveExamEvents)
        .where(eq(s.liveExamEvents.attemptId, id));
      if (amount.value >= 1000)
        throw new HttpException(
          "The monitoring event limit has been reached.",
          429,
        );
      const events = input.events
        .filter((event) => {
          const occurred = new Date(event.occurredAt).getTime();
          return (
            occurred >= attempt.startedAt.getTime() &&
            occurred <= windowEnd &&
            occurred <= now + 5_000
          );
        })
        .filter(
          (event) =>
            exam.monitoring.recordClipboard ||
            !["copy", "paste", "cut"].includes(event.type),
        )
        .slice(0, 1000 - amount.value);
      if (!events.length) return { accepted: 0 };
      const inserted = await tx
        .insert(s.liveExamEvents)
        .values(
          events.map((event) => ({
            attemptId: id,
            organizationId: attempt.organizationId,
            memberId: attempt.memberId,
            clientId: event.id,
            kind: event.type,
            clientOccurredAt: new Date(event.occurredAt),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: s.liveExamEvents.id });
      return { accepted: inserted.length };
    });
  }
  private async finalizeExpired(
    actor: Actor,
    examId?: string,
    organizationId?: string,
  ) {
    // Visibility is enforced by each caller's RLS; this never scans another student's attempts.
    await this.service.scope(actor, async (tx) => {
      const conditions = [
        eq(s.liveExamAttempts.status, "in_progress"),
        lt(s.liveExamAttempts.deadlineAt, new Date()),
      ];
      if (examId) conditions.push(eq(s.liveExamAttempts.examId, examId));
      if (organizationId)
        conditions.push(eq(s.liveExamAttempts.organizationId, organizationId));
      await tx
        .update(s.liveExamAttempts)
        .set({
          status: "submitted",
          submittedAt: sql`${s.liveExamAttempts.deadlineAt}`,
          version: sql`${s.liveExamAttempts.version}+1`,
          updatedAt: new Date(),
        })
        .where(and(...conditions));
    });
  }
  private internalActor(actor: Actor): Actor {
    return { ...actor, role: "platform_admin" };
  }
  private async grade(actor: Actor, id: string) {
    // Ownership is checked under the caller's RLS before server-only MCQ keys
    // are read. Coding source is never executed or sent to another service.
    const visible = await this.service.scope(actor, async (tx) => {
      const [attempt] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(eq(s.liveExamAttempts.id, id));
      if (
        !attempt ||
        (actor.role !== "platform_admin" && attempt.memberId !== actor.id)
      )
        throw new NotFoundException("Exam attempt not found.");
      return attempt;
    });
    if (
      visible.status === "in_progress" ||
      visible.status === "graded" ||
      (visible.result && visible.status !== "grading")
    )
      return;
    await this.service.scope(this.internalActor(actor), async (tx) => {
      const [attempt] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(eq(s.liveExamAttempts.id, id))
        .for("update");
      if (
        !attempt ||
        attempt.status === "in_progress" ||
        attempt.status === "graded" ||
        (attempt.result && attempt.status !== "grading")
      )
        return;
      const exam = await this.row(tx, attempt.examId);
      if (
        exam.status === "cancelled" ||
        (await this.organization(tx, exam.organizationId)).status !== "active"
      )
        return;
      const [keys] = await tx
        .select()
        .from(s.liveExamQuestions)
        .where(eq(s.liveExamQuestions.examId, exam.id));
      if (!keys) throw new Error("Missing exam questions");
      const questions: ExamResult["questions"] = keys.questions.map(
        (question) => {
          const answer = attempt.answers.find(
            (item) => item.questionId === question.id,
          );
          const base = {
            questionId: question.id,
            kind: question.kind,
            title: question.title,
            points: question.points,
          };
          if (question.kind === "mcq")
            return {
              ...base,
              earnedPoints:
                answer?.selectedOption === question.correctOption
                  ? question.points
                  : 0,
              verdict:
                answer?.selectedOption === question.correctOption
                  ? "Correct"
                  : answer?.selectedOption == null
                    ? "Unanswered"
                    : "Incorrect",
              correctOption: question.correctOption,
              explanation: question.explanation,
            };
          const reviewed = attempt.result?.questions.find(
            (item) =>
              item.questionId === question.id &&
              item.verdict === "Manually reviewed",
          );
          if (reviewed) return reviewed;
          return {
            ...base,
            earnedPoints: answer?.code?.trim() ? null : 0,
            verdict: answer?.code?.trim()
              ? "Awaiting manual review"
              : "Unanswered",
          };
        },
      );
      const pending = questions.some(
        (question) => question.earnedPoints === null,
      );
      const totalPoints = total(keys.questions),
        earnedPoints = pending
          ? null
          : Math.round(
              questions.reduce(
                (sum, question) => sum + (question.earnedPoints || 0),
                0,
              ) * 100,
            ) / 100;
      const percentage =
        earnedPoints === null
          ? null
          : Math.round((earnedPoints / totalPoints) * 10000) / 100;
      const result: ExamResult = {
        earnedPoints,
        totalPoints,
        percentage,
        passed:
          percentage === null ? null : percentage >= exam.passingPercentage,
        questions,
      };
      await tx
        .update(s.liveExamAttempts)
        .set({
          status: pending ? "submitted" : "graded",
          result,
          version: attempt.version + 1,
          gradingToken: null,
          gradingStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(s.liveExamAttempts.id, id));
    });
  }
  private async gradeBatch(actor: Actor, id: string) {
    const attempts = await this.service.scope(actor, (tx) =>
      tx
        .select({ id: s.liveExamAttempts.id })
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.examId, id),
            inArray(s.liveExamAttempts.status, ["submitted", "grading"]),
            sql`(${s.liveExamAttempts.result} is null OR ${s.liveExamAttempts.status}='grading')`,
          ),
        )
        .orderBy(s.liveExamAttempts.updatedAt)
        .limit(3),
    );
    for (const attempt of attempts) await this.grade(actor, attempt.id);
  }
  async results(actor: Actor, id: string): Promise<ExamResults> {
    this.admin(actor);
    await this.finalizeExpired(actor, id);
    await this.gradeBatch(actor, id);
    return this.service.scope(actor, async (tx) => {
      const exam = await this.row(tx, id);
      const roster = await tx
        .select()
        .from(s.liveExamRoster)
        .where(eq(s.liveExamRoster.examId, id));
      const attempts = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(eq(s.liveExamAttempts.examId, id));
      const counts = await tx
        .select({ attemptId: s.liveExamEvents.attemptId, value: count() })
        .from(s.liveExamEvents)
        .innerJoin(
          s.liveExamAttempts,
          eq(s.liveExamAttempts.id, s.liveExamEvents.attemptId),
        )
        .where(eq(s.liveExamAttempts.examId, id))
        .groupBy(s.liveExamEvents.attemptId);
      return {
        exam: await this.summary(tx, exam),
        rows: roster.map((p) => {
          const a = attempts.find((a) => a.memberId === p.memberId);
          return {
            memberId: p.memberId,
            name: p.name,
            email: p.email,
            studentId: p.studentId,
            branchName: p.branchName,
            branchCode: p.branchCode,
            attemptId: a?.id || null,
            status: (a?.status ||
              "not_started") as ExamResults["rows"][number]["status"],
            startedAt: iso(a?.startedAt || null),
            submittedAt: iso(a?.submittedAt || null),
            deadlineAt: iso(a?.deadlineAt || null),
            eventCount: counts.find((c) => c.attemptId === a?.id)?.value || 0,
            earnedPoints: a?.result?.earnedPoints ?? null,
            totalPoints: total(exam.publicQuestions),
            percentage: a?.result?.percentage ?? null,
            passed: a?.result?.passed ?? null,
          };
        }),
      };
    });
  }
  async adminAttempt(
    actor: Actor,
    id: string,
    attemptId: string,
  ): Promise<AdminExamAttempt> {
    this.admin(actor);
    await this.finalizeExpired(actor, id);
    await this.service.scope(actor, async (tx) => {
      const [a] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.id, attemptId),
            eq(s.liveExamAttempts.examId, id),
          ),
        );
      if (!a) throw new NotFoundException("Attempt not found in this exam.");
    });
    await this.grade(actor, attemptId);
    return this.service.scope(actor, async (tx) => {
      const [a] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.id, attemptId),
            eq(s.liveExamAttempts.examId, id),
          ),
        );
      const exam = await this.row(tx, id);
      const events = await tx
        .select()
        .from(s.liveExamEvents)
        .where(eq(s.liveExamEvents.attemptId, attemptId))
        .orderBy(s.liveExamEvents.occurredAt);
      return {
        id: a.id,
        revision: a.version,
        memberId: a.memberId,
        status: a.status as AdminExamAttempt["status"],
        startedAt: a.startedAt.toISOString(),
        deadlineAt: a.deadlineAt.toISOString(),
        submittedAt: iso(a.submittedAt),
        answers: a.answers,
        result: a.result || {
          earnedPoints: null,
          totalPoints: total(exam.publicQuestions),
          percentage: null,
          passed: null,
          questions: [],
        },
        events: events.map((e) => ({
          id: e.clientId,
          type: e.kind as ExamMonitorEvent["type"],
          occurredAt: e.clientOccurredAt.toISOString(),
          receivedAt: e.occurredAt.toISOString(),
        })),
      };
    });
  }
  async manualGrade(
    actor: Actor,
    id: string,
    attemptId: string,
    supplied: z.infer<typeof manualExamGradeInput>,
  ): Promise<AdminExamAttempt> {
    this.admin(actor);
    const input = manualExamGradeInput.parse(supplied);
    await this.service.scope(actor, async (tx) => {
      const reference = await this.row(tx, id);
      this.active(await this.organization(tx, reference.organizationId, true));
      const exam = await this.row(tx, id, true);
      if (exam.status !== "published" || exam.resultsReleasedAt)
        throw new ConflictException(
          "Manual grading is available for unreleased, published manual exams only.",
        );
      const [attempt] = await tx
        .select()
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.id, attemptId),
            eq(s.liveExamAttempts.examId, id),
          ),
        )
        .for("update");
      if (!attempt)
        throw new NotFoundException("Attempt not found in this exam.");
      if (
        attempt.status === "in_progress" ||
        attempt.status === "grading" ||
        !attempt.result
      )
        throw new ConflictException(
          "Wait for the student to submit and the initial evaluation to complete before reviewing.",
        );
      if (attempt.version !== input.revision)
        throw new ConflictException(
          "This attempt changed in another session. Reload it before grading.",
        );
      const coding = exam.publicQuestions.filter((q) => q.kind === "coding");
      if (
        new Set(input.scores.map((q) => q.questionId)).size !== coding.length ||
        input.scores.length !== coding.length ||
        input.scores.some(
          (score) =>
            !coding.some(
              (q) => q.id === score.questionId && score.points <= q.points,
            ),
        )
      )
        throw new BadRequestException(
          "Provide a score within the maximum points for every coding question.",
        );
      const questions = attempt.result.questions.map((q) => {
        const score = input.scores.find(
          (score) => score.questionId === q.questionId,
        );
        return q.kind === "coding" && score
          ? {
              ...q,
              earnedPoints: Math.round(score.points * 100) / 100,
              verdict: "Manually reviewed",
              explanation: score.feedback,
            }
          : q;
      });
      const totalPoints = total(exam.publicQuestions),
        earnedPoints =
          Math.round(
            questions.reduce((n, q) => n + (q.earnedPoints || 0), 0) * 100,
          ) / 100,
        percentage = Math.round((earnedPoints / totalPoints) * 10000) / 100;
      const result: ExamResult = {
        earnedPoints,
        totalPoints,
        percentage,
        passed: percentage >= exam.passingPercentage,
        questions,
      };
      await tx
        .update(s.liveExamAttempts)
        .set({
          result,
          status: "graded",
          version: attempt.version + 1,
          gradingToken: null,
          updatedAt: new Date(),
        })
        .where(eq(s.liveExamAttempts.id, attemptId));
      await this.service.log(
        tx,
        actor,
        "exam.attempt_reviewed",
        exam.organizationId,
        attemptId,
      );
    });
    return this.adminAttempt(actor, id, attemptId);
  }
  async release(
    actor: Actor,
    id: string,
    revision: number,
  ): Promise<AdminExam> {
    this.admin(actor);
    await this.finalizeExpired(actor, id);
    await this.gradeBatch(actor, id);
    return this.service.scope(actor, async (tx) => {
      const reference = await this.row(tx, id);
      this.active(await this.organization(tx, reference.organizationId, true));
      await this.examLock(tx, id, true);
      const row = await this.row(tx, id, true);
      this.revision(row, revision);
      if (row.status !== "published" || Date.now() < row.endsAt.getTime())
        throw new ConflictException(
          "Results can only be released after the published exam has closed.",
        );
      const [pending] = await tx
        .select({ value: count() })
        .from(s.liveExamAttempts)
        .where(
          and(
            eq(s.liveExamAttempts.examId, id),
            sql`${s.liveExamAttempts.status}<>'graded'`,
          ),
        );
      if (pending.value)
        throw new ConflictException(
          "Some submissions still need review. Grade the remaining submissions before releasing results.",
        );
      if (row.resultsReleasedAt) return this.adminView(tx, row);
      const [updated] = await tx
        .update(s.liveExams)
        .set({
          resultsReleasedAt: new Date(),
          revision: row.revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.liveExams.id, id))
        .returning();
      await this.service.log(
        tx,
        actor,
        "exam.results_released",
        row.organizationId,
        id,
      );
      return this.adminView(tx, updated);
    });
  }
}
