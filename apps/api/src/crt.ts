import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type CrtTopic,
  type CrtTopicDetail,
  type CrtTopicDraft,
  type CrtAssignments,
  type CrtAudience,
  type CrtBankQuestion,
  type CrtStudentTopic,
  type CrtStudentTopicDetail,
  type CrtPracticeSession,
  type CrtResult,
  type LessonFile,
  type LessonQuestion,
} from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import { lockOrganizationBranches } from "./branches.js";
import { resolvePolicies } from "./access.js";
import {
  questionImageInput,
  validateQuestionImages,
} from "./question-images.js";
import { LessonService } from "./lessons.js";
import * as s from "./schema.js";

const subject = z.enum(["quantitative", "reasoning", "verbal", "soft-skills"]);
const short = (max: number) => z.string().trim().min(1).max(max);
const draftQuestion = z
  .object({
    id: short(100),
    prompt: z.string().trim().max(5000),
    image: questionImageInput.optional(),
    options: z.array(z.string().trim().max(2000)).min(2).max(6),
    correctOption: z.number().int().min(0).max(5).optional(),
    explanation: z.string().trim().max(5000).optional(),
  })
  .strict();
export const crtTopicInput = z
  .object({
    title: short(180),
    subjectId: subject,
    description: z.string().trim().max(5000),
    passingScore: z.number().int().min(1).max(100),
    pdfUploadId: z.uuid().optional(),
    questions: z.array(draftQuestion).max(100),
  })
  .strict()
  .refine(
    (v) => new Set(v.questions.map((q) => q.id)).size === v.questions.length,
    "Use a unique ID for every question.",
  );
export const crtUpdateInput = crtTopicInput.safeExtend({
  revision: z.number().int().positive(),
});
export const crtRevisionInput = z
  .object({ revision: z.number().int().positive() })
  .strict();
export const crtAssignmentsInput = z
  .object({
    organizationId: z.uuid(),
    branchId: z.uuid(),
    topics: z
      .array(z.object({ topicId: z.uuid(), versionId: z.uuid() }).strict())
      .max(1000),
  })
  .strict()
  .refine(
    (v) => new Set(v.topics.map((t) => t.topicId)).size === v.topics.length,
    "Select each topic only once.",
  );
export const crtBankInput = z.object({ question: draftQuestion }).strict();
export const crtBankUpdateInput = crtBankInput
  .extend({ active: z.boolean(), revision: z.number().int().positive() })
  .strict();
const answers = z.record(short(100), z.number().int().min(0).max(5));
export const crtSubmitInput = z
  .object({
    versionId: z.uuid(),
    clientId: z.uuid(),
    answers,
    readAcknowledged: z.literal(true),
  })
  .strict();
export const crtPracticeInput = z
  .object({
    subjectId: subject.optional(),
    topicIds: z.array(z.uuid()).max(100).optional(),
    count: z.union([z.literal(10), z.literal(20), z.literal(50)]),
  })
  .strict();
export const crtPracticeSubmitInput = z.object({ answers }).strict();
type Version = typeof s.crtVersions.$inferSelect;
type Attempt = typeof s.crtAttempts.$inferSelect;
const publicQuestion = (question: LessonQuestion): LessonQuestion => {
  const { correctOption, explanation, ...visible } = question;
  return visible;
};
const asFile = (upload: typeof s.lessonUploads.$inferSelect): LessonFile => ({
  id: upload.id,
  fileName: upload.fileName,
  contentType: upload.contentType,
  size: upload.size,
});
function validQuestions(questions: LessonQuestion[]) {
  if (
    !questions.length ||
    questions.some(
      (q) =>
        !q.prompt.trim() ||
        q.options.some((o) => !o.trim()) ||
        q.correctOption === undefined ||
        q.correctOption < 0 ||
        q.correctOption >= q.options.length,
    )
  )
    throw new BadRequestException(
      "Complete each question and choose its correct answer before publishing.",
    );
}
export class CrtService {
  constructor(readonly service: SlateService) {}
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException("Platform Admin access is required.");
  }
  private async branch(
    tx: Transaction,
    organizationId: string,
    branchId: string,
  ) {
    await lockOrganizationBranches(tx, organizationId);
    const [org] = await tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, organizationId));
    if (!org || org.status !== "active")
      throw new BadRequestException("Select an active organization.");
    const [branch] = await tx
      .select()
      .from(s.organizationBranches)
      .where(
        and(
          eq(s.organizationBranches.organizationId, organizationId),
          eq(s.organizationBranches.id, branchId),
        ),
      );
    if (!branch)
      throw new BadRequestException(
        "Select a branch belonging to this organization.",
      );
    return branch;
  }
  private async student(tx: Transaction, actor: Actor) {
    if (actor.role !== "student" || !actor.organizationId)
      throw new ForbiddenException("Student access is required.");
    await lockOrganizationBranches(tx, actor.organizationId);
    const [member] = await tx
      .select()
      .from(s.members)
      .where(
        and(
          eq(s.members.id, actor.id),
          eq(s.members.authUserId, actor.authId),
          eq(s.members.organizationId, actor.organizationId),
          eq(s.members.role, "student"),
          eq(s.members.status, "active"),
        ),
      );
    const [org] = await tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, actor.organizationId));
    if (!member || !org || org.status !== "active")
      throw new ForbiddenException(
        "Your organization membership is no longer active.",
      );
    const policies = await tx
      .select()
      .from(s.accessPolicies)
      .where(eq(s.accessPolicies.organizationId, actor.organizationId));
    if (
      !resolvePolicies(
        org,
        member,
        policies,
        [],
        false,
      ).effective.features.includes("crt")
    )
      throw new ForbiddenException(
        "Platform Admin has not assigned CRT access.",
      );
    const [branch] = await tx
      .select()
      .from(s.organizationBranches)
      .where(
        and(
          eq(s.organizationBranches.organizationId, actor.organizationId),
          eq(s.organizationBranches.code, member.branchCode || ""),
        ),
      );
    return { member, branch };
  }
  private async available(
    tx: Transaction,
    actor: Actor,
    filters?: z.infer<typeof crtPracticeInput>,
  ) {
    const { branch } = await this.student(tx, actor);
    if (!branch) return [];
    return tx
      .select({ version: s.crtVersions })
      .from(s.crtAssignments)
      .innerJoin(
        s.crtVersions,
        eq(s.crtVersions.id, s.crtAssignments.versionId),
      )
      .where(
        and(
          eq(s.crtAssignments.organizationId, actor.organizationId!),
          eq(s.crtAssignments.branchId, branch.id),
          filters?.subjectId
            ? sql`${s.crtVersions.content}->>'subjectId'=${filters.subjectId}`
            : undefined,
          filters?.topicIds?.length
            ? inArray(s.crtAssignments.topicId, filters.topicIds)
            : undefined,
        ),
      )
      .then((rows) => rows.map((r) => r.version));
  }
  private async assigned(tx: Transaction, actor: Actor, topicId: string) {
    const { branch } = await this.student(tx, actor);
    const [row] = branch
      ? await tx
          .select({ version: s.crtVersions })
          .from(s.crtAssignments)
          .innerJoin(
            s.crtVersions,
            eq(s.crtVersions.id, s.crtAssignments.versionId),
          )
          .where(
            and(
              eq(s.crtAssignments.organizationId, actor.organizationId!),
              eq(s.crtAssignments.branchId, branch.id),
              eq(s.crtAssignments.topicId, topicId),
            ),
          )
          .limit(1)
      : [];
    if (!row)
      throw new NotFoundException(
        "This CRT topic is not assigned to your organization and branch.",
      );
    return row.version;
  }
  private progress(tx: Transaction, actor: Actor, versionIds: string[]) {
    if (!versionIds.length) return Promise.resolve([]);
    return tx
      .select({
        versionId: s.crtAttempts.versionId,
        bestScore: sql<
          number | null
        >`max((${s.crtAttempts.result}->>'score')::numeric)`.mapWith((v) =>
          v === null ? null : Number(v),
        ),
        completed: sql<boolean>`coalesce(bool_or((${s.crtAttempts.result}->>'passed')::boolean),false)`,
      })
      .from(s.crtAttempts)
      .where(
        and(
          eq(s.crtAttempts.memberId, actor.id),
          eq(s.crtAttempts.kind, "topic"),
          inArray(s.crtAttempts.versionId, versionIds),
        ),
      )
      .groupBy(s.crtAttempts.versionId);
  }
  private async pdfUpload(
    tx: Transaction,
    id: string | undefined,
    required = false,
  ) {
    if (!id) {
      if (required)
        throw new BadRequestException(
          "Upload a PDF for this topic before publishing.",
        );
      return null;
    }
    const [row] = await tx
      .select()
      .from(s.lessonUploads)
      .where(eq(s.lessonUploads.id, id));
    if (
      !row ||
      row.purpose !== "crt_pdf" ||
      row.status !== "ready" ||
      !row.objectKey ||
      row.contentType !== "application/pdf" ||
      row.size > 20 * 1024 * 1024
    )
      throw new BadRequestException(
        "Finish uploading a valid PDF before saving this topic.",
      );
    return row;
  }
  private topic(
    row: typeof s.crtTopics.$inferSelect,
    versions: Pick<Version, "id" | "topicId" | "number">[],
    pdf: LessonFile | null,
  ): CrtTopic {
    const latest = versions
      .filter((v) => v.topicId === row.id)
      .sort((a, b) => b.number - a.number)[0];
    return {
      ...row.draft,
      id: row.id,
      revision: row.revision,
      status: row.status as CrtTopic["status"],
      pdf,
      versionId: latest?.id || null,
      version: latest?.number || 0,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async list(actor: Actor): Promise<CrtTopic[]> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const rows = await tx
        .select()
        .from(s.crtTopics)
        .orderBy(desc(s.crtTopics.updatedAt));
      const versions = await tx
        .select({
          id: s.crtVersions.id,
          topicId: s.crtVersions.topicId,
          number: s.crtVersions.number,
        })
        .from(s.crtVersions);
      const ids = rows.flatMap((r) =>
        r.draft.pdfUploadId ? [r.draft.pdfUploadId] : [],
      );
      const uploads = ids.length
        ? await tx
            .select()
            .from(s.lessonUploads)
            .where(inArray(s.lessonUploads.id, ids))
        : [];
      return rows.map((row) =>
        this.topic(
          row,
          versions,
          uploads.find((u) => u.id === row.draft.pdfUploadId)
            ? asFile(uploads.find((u) => u.id === row.draft.pdfUploadId)!)
            : null,
        ),
      );
    });
  }
  async detail(actor: Actor, id: string): Promise<CrtTopicDetail> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.crtTopics)
        .where(eq(s.crtTopics.id, id));
      if (!row) throw new NotFoundException("CRT topic not found.");
      const versions = await tx
        .select()
        .from(s.crtVersions)
        .where(eq(s.crtVersions.topicId, id))
        .orderBy(desc(s.crtVersions.number));
      const pdf = await this.pdfUpload(tx, row.draft.pdfUploadId);
      return {
        ...this.topic(row, versions, pdf ? asFile(pdf) : null),
        versions: versions.map((v) => ({
          id: v.id,
          topicId: id,
          version: v.number,
          title: v.content.title,
          createdAt: v.createdAt.toISOString(),
        })),
      };
    });
  }
  async create(actor: Actor, raw: CrtTopicDraft) {
    this.admin(actor);
    const input = crtTopicInput.parse(raw);
    const id = await this.service.scope(actor, async (tx) => {
      await this.pdfUpload(tx, input.pdfUploadId);
      await validateQuestionImages(tx, input.questions);
      const [row] = await tx
        .insert(s.crtTopics)
        .values({ draft: input, createdBy: actor.id })
        .returning();
      return row.id;
    });
    return this.detail(actor, id);
  }
  async update(actor: Actor, id: string, raw: z.infer<typeof crtUpdateInput>) {
    this.admin(actor);
    const { revision, ...input } = crtUpdateInput.parse(raw);
    await this.service.scope(actor, async (tx) => {
      await this.pdfUpload(tx, input.pdfUploadId);
      await validateQuestionImages(tx, input.questions);
      const [row] = await tx
        .update(s.crtTopics)
        .set({
          draft: input,
          status: "draft",
          revision: revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(s.crtTopics.id, id), eq(s.crtTopics.revision, revision)))
        .returning();
      if (!row)
        throw new ConflictException(
          "This topic changed. Reload it before saving.",
        );
    });
    return this.detail(actor, id);
  }
  async publish(actor: Actor, id: string, revision: number) {
    this.admin(actor);
    await this.service.scope(actor, async (tx) => {
      const [row] = await tx
        .select()
        .from(s.crtTopics)
        .where(eq(s.crtTopics.id, id))
        .for("update");
      if (!row) throw new NotFoundException();
      if (row.revision !== revision)
        throw new ConflictException(
          "This topic changed. Reload before publishing.",
        );
      if (row.status === "published")
        throw new ConflictException("This revision is already published.");
      validQuestions(row.draft.questions);
      await validateQuestionImages(tx, row.draft.questions);
      const pdf = await this.pdfUpload(tx, row.draft.pdfUploadId, true);
      const [latest] = await tx
        .select()
        .from(s.crtVersions)
        .where(eq(s.crtVersions.topicId, id))
        .orderBy(desc(s.crtVersions.number))
        .limit(1);
      await tx.insert(s.crtVersions).values({
        topicId: id,
        number: (latest?.number || 0) + 1,
        content: { ...row.draft, pdf: asFile(pdf!) },
      });
      await tx
        .update(s.crtTopics)
        .set({
          status: "published",
          revision: revision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.crtTopics.id, id));
    });
    return this.detail(actor, id);
  }
  async audience(actor: Actor, organizationId: string): Promise<CrtAudience> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      await lockOrganizationBranches(tx, organizationId);
      const branches = await tx
        .select()
        .from(s.organizationBranches)
        .where(eq(s.organizationBranches.organizationId, organizationId))
        .orderBy(asc(s.organizationBranches.name));
      const students = await tx
        .select({ branchCode: s.members.branchCode })
        .from(s.members)
        .where(
          and(
            eq(s.members.organizationId, organizationId),
            eq(s.members.role, "student"),
            eq(s.members.status, "active"),
          ),
        );
      return {
        organizationId,
        branches: branches.map((b) => ({
          id: b.id,
          name: b.name,
          code: b.code,
          studentCount: students.filter((m) => m.branchCode === b.code).length,
        })),
      };
    });
  }
  async assignments(
    actor: Actor,
    organizationId: string,
    branchId: string,
  ): Promise<CrtAssignments> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      await this.branch(tx, organizationId, branchId);
      const topics = await tx
        .select({
          topicId: s.crtAssignments.topicId,
          versionId: s.crtAssignments.versionId,
        })
        .from(s.crtAssignments)
        .where(
          and(
            eq(s.crtAssignments.organizationId, organizationId),
            eq(s.crtAssignments.branchId, branchId),
          ),
        );
      return { organizationId, branchId, topics };
    });
  }
  async assign(actor: Actor, raw: CrtAssignments) {
    this.admin(actor);
    const input = crtAssignmentsInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      await this.branch(tx, input.organizationId, input.branchId);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`slate:crt:${input.branchId}`},0))`,
      );
      const versions = input.topics.length
        ? await tx
            .select()
            .from(s.crtVersions)
            .where(
              inArray(
                s.crtVersions.id,
                input.topics.map((t) => t.versionId),
              ),
            )
        : [];
      if (
        input.topics.some(
          (t) =>
            !versions.some(
              (v) => v.id === t.versionId && v.topicId === t.topicId,
            ),
        )
      )
        throw new BadRequestException(
          "Assign a published version of each selected topic.",
        );
      await tx
        .delete(s.crtAssignments)
        .where(
          and(
            eq(s.crtAssignments.organizationId, input.organizationId),
            eq(s.crtAssignments.branchId, input.branchId),
          ),
        );
      if (input.topics.length)
        await tx.insert(s.crtAssignments).values(
          input.topics.map((t) => ({
            ...t,
            organizationId: input.organizationId,
            branchId: input.branchId,
          })),
        );
      // The student shell observes this revision and discards stale CRT lists,
      // including when an assignment changes without a feature toggle.
      await tx
        .update(s.organizations)
        .set({
          accessRevision: sql`${s.organizations.accessRevision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(s.organizations.id, input.organizationId));
      await tx.insert(s.audit).values({
        actorId: actor.id,
        organizationId: input.organizationId,
        action: "crt.assignments.updated",
        resourceId: input.branchId,
      });
      return input;
    });
  }
  async bank(actor: Actor, topicId: string): Promise<CrtBankQuestion[]> {
    this.admin(actor);
    await this.detail(actor, topicId);
    return this.service.scope(actor, (tx) =>
      tx
        .select({
          id: s.crtBank.id,
          topicId: s.crtBank.topicId,
          question: s.crtBank.question,
          active: s.crtBank.active,
          revision: s.crtBank.revision,
        })
        .from(s.crtBank)
        .where(eq(s.crtBank.topicId, topicId))
        .orderBy(asc(s.crtBank.createdAt)),
    );
  }
  async createBank(
    actor: Actor,
    topicId: string,
    raw: z.infer<typeof crtBankInput>,
  ) {
    this.admin(actor);
    const input = crtBankInput.parse(raw);
    validQuestions([input.question]);
    await this.detail(actor, topicId);
    return this.service.scope(actor, async (tx) => {
      await validateQuestionImages(tx, [input.question]);
      const [row] = await tx
        .insert(s.crtBank)
        .values({ topicId, question: input.question })
        .returning();
      return {
        id: row.id,
        topicId,
        question: row.question,
        active: row.active,
        revision: row.revision,
      };
    });
  }
  async updateBank(
    actor: Actor,
    id: string,
    raw: z.infer<typeof crtBankUpdateInput>,
  ) {
    this.admin(actor);
    const input = crtBankUpdateInput.parse(raw);
    validQuestions([input.question]);
    return this.service.scope(actor, async (tx) => {
      await validateQuestionImages(tx, [input.question]);
      const [row] = await tx
        .update(s.crtBank)
        .set({
          question: input.question,
          active: input.active,
          revision: input.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(s.crtBank.id, id), eq(s.crtBank.revision, input.revision)),
        )
        .returning();
      if (!row)
        throw new ConflictException(
          "This practice question changed. Reload before saving.",
        );
      return {
        id: row.id,
        topicId: row.topicId,
        question: row.question,
        active: row.active,
        revision: row.revision,
      };
    });
  }
  async studentList(actor: Actor): Promise<CrtStudentTopic[]> {
    return this.service.scope(actor, async (tx) => {
      const { branch } = await this.student(tx, actor);
      if (!branch) return [];
      const topics = await tx
        .select({
          id: s.crtVersions.topicId,
          versionId: s.crtVersions.id,
          version: s.crtVersions.number,
          title: sql<string>`${s.crtVersions.content}->>'title'`,
          subjectId: sql<
            CrtStudentTopic["subjectId"]
          >`${s.crtVersions.content}->>'subjectId'`,
          description: sql<string>`${s.crtVersions.content}->>'description'`,
          passingScore: sql<number>`(${s.crtVersions.content}->>'passingScore')::int`,
          questionCount: sql<number>`jsonb_array_length(${s.crtVersions.content}->'questions')`,
        })
        .from(s.crtAssignments)
        .innerJoin(
          s.crtVersions,
          eq(s.crtVersions.id, s.crtAssignments.versionId),
        )
        .where(
          and(
            eq(s.crtAssignments.organizationId, actor.organizationId!),
            eq(s.crtAssignments.branchId, branch.id),
          ),
        );
      const progress = await this.progress(
        tx,
        actor,
        topics.map((t) => t.versionId),
      );
      return topics
        .map((topic) => {
          const saved = progress.find((p) => p.versionId === topic.versionId);
          return {
            ...topic,
            completed: saved?.completed || false,
            bestScore: saved?.bestScore ?? null,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
    });
  }
  async studentDetail(
    actor: Actor,
    id: string,
  ): Promise<CrtStudentTopicDetail> {
    return this.service.scope(actor, async (tx) => {
      const v = await this.assigned(tx, actor, id),
        [progress] = await this.progress(tx, actor, [v.id]);
      return {
        id: v.topicId,
        title: v.content.title,
        description: v.content.description,
        subjectId: v.content.subjectId,
        passingScore: v.content.passingScore,
        versionId: v.id,
        version: v.number,
        questionCount: v.content.questions.length,
        completed: progress?.completed || false,
        bestScore: progress?.bestScore ?? null,
        pdf: v.content.pdf,
        questions: v.content.questions.map(publicQuestion),
      };
    });
  }
  async pdf(actor: Actor, id: string) {
    if (!this.service.lessonStorage.configured())
      throw new ServiceUnavailableException(
        "Private file storage is not configured.",
      );
    const upload = await this.service.scope(actor, async (tx) => {
      const v = await this.assigned(tx, actor, id);
      await tx.execute(
        sql`select set_config('slate.crt_pdf_id',${v.content.pdf.id},true)`,
      );
      return this.pdfUpload(tx, v.content.pdf.id, true);
    });
    return {
      url: await this.service.lessonStorage.download(
        upload!.objectKey!,
        upload!.fileName,
        false,
      ),
      expiresIn: 3600,
    };
  }
  async topicImage(actor: Actor, id: string, uploadId: string) {
    await this.service.scope(actor, async (tx) => {
      const v = await this.assigned(tx, actor, id);
      if (!v.content.questions.some((q) => q.image?.uploadId === uploadId))
        throw new NotFoundException("Image not found in this assigned topic.");
    });
    return new LessonService(
      this.service,
      this.service.lessonStorage,
    ).authorizedQuestionImage(actor, uploadId);
  }
  private result(
    id: string,
    questions: LessonQuestion[],
    answers: Record<string, number>,
    passingScore: number,
  ): CrtResult {
    if (
      Object.keys(answers).length !== questions.length ||
      questions.some(
        (q) => answers[q.id] === undefined || answers[q.id] >= q.options.length,
      )
    )
      throw new BadRequestException("Answer every question before submitting.");
    const correct = questions.filter(
      (q) => answers[q.id] === q.correctOption,
    ).length;
    return {
      id,
      score: Math.round((correct / questions.length) * 10000) / 100,
      correct,
      total: questions.length,
      passed: correct * 100 >= passingScore * questions.length,
      submittedAt: new Date().toISOString(),
      questions: questions.map((q) => ({
        ...q,
        selectedOption: answers[q.id],
        correct: answers[q.id] === q.correctOption,
      })),
    };
  }
  async submit(
    actor: Actor,
    topicId: string,
    raw: z.infer<typeof crtSubmitInput>,
  ): Promise<CrtResult> {
    const input = crtSubmitInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      const v = await this.assigned(tx, actor, topicId);
      if (v.id !== input.versionId)
        throw new ConflictException(
          "Your assigned topic version changed. Reload it before submitting.",
        );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`slate:crt-attempt:${actor.id}:${input.clientId}`},0))`,
      );
      const [existing] = await tx
        .select()
        .from(s.crtAttempts)
        .where(
          and(
            eq(s.crtAttempts.memberId, actor.id),
            eq(s.crtAttempts.clientId, input.clientId),
          ),
        );
      if (existing) {
        if (existing.kind !== "topic" || existing.versionId !== v.id)
          throw new ConflictException(
            "Use a new submission identifier for this topic.",
          );
        return existing.result!;
      }
      const id = randomUUID(),
        result = this.result(
          id,
          v.content.questions,
          input.answers,
          v.content.passingScore,
        );
      await tx.insert(s.crtAttempts).values({
        id,
        clientId: input.clientId,
        organizationId: actor.organizationId!,
        memberId: actor.id,
        kind: "topic",
        topicId,
        versionId: v.id,
        questions: v.content.questions.map((q) => ({
          ...q,
          topicId,
          topicTitle: v.content.title,
          subjectId: v.content.subjectId,
        })),
        passingScore: v.content.passingScore,
        readAcknowledged: true,
        answers: input.answers,
        result,
        submittedAt: new Date(result.submittedAt),
      });
      return result;
    });
  }
  private session(row: Attempt): CrtPracticeSession {
    return {
      id: row.id,
      questions: row.questions.map((q) => ({
        ...publicQuestion(q),
        topicId: q.topicId,
        topicTitle: q.topicTitle,
        subjectId: q.subjectId,
      })),
      createdAt: row.createdAt.toISOString(),
      result: row.result,
    };
  }
  async practice(
    actor: Actor,
    raw: z.infer<typeof crtPracticeInput>,
  ): Promise<CrtPracticeSession> {
    const input = crtPracticeInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      const versions = await this.available(tx, actor, input);
      if (input.topicIds?.length) {
        if (
          input.topicIds.some((id) => !versions.some((v) => v.topicId === id))
        )
          throw new ForbiddenException(
            "Choose topics assigned to your branch within the selected subject.",
          );
      }
      if (!versions.length)
        throw new BadRequestException(
          "No CRT topics are assigned for this selection.",
        );
      const bank = await tx
        .select()
        .from(s.crtBank)
        .where(
          and(
            inArray(
              s.crtBank.topicId,
              versions.map((v) => v.topicId),
            ),
            eq(s.crtBank.active, true),
          ),
        );
      const questions = versions.flatMap((v) =>
        [
          ...v.content.questions,
          ...bank.filter((q) => q.topicId === v.topicId).map((q) => q.question),
        ].map((q) => ({
          ...q,
          id: randomUUID(),
          topicId: v.topicId,
          topicTitle: v.content.title,
          subjectId: v.content.subjectId,
        })),
      );
      for (let i = questions.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [questions[i], questions[j]] = [questions[j], questions[i]];
      }
      const [row] = await tx
        .insert(s.crtAttempts)
        .values({
          clientId: randomUUID(),
          organizationId: actor.organizationId!,
          memberId: actor.id,
          kind: "practice",
          questions: questions.slice(0, input.count),
          passingScore: 100,
        })
        .returning();
      return this.session(row);
    });
  }
  private async ownedPractice(
    tx: Transaction,
    actor: Actor,
    id: string,
    lock = false,
  ) {
    const { branch } = await this.student(tx, actor);
    const assignedTopics = branch
      ? await tx
          .select({ topicId: s.crtAssignments.topicId })
          .from(s.crtAssignments)
          .where(
            and(
              eq(s.crtAssignments.organizationId, actor.organizationId!),
              eq(s.crtAssignments.branchId, branch.id),
            ),
          )
      : [];
    const query = tx
      .select()
      .from(s.crtAttempts)
      .where(
        and(
          eq(s.crtAttempts.id, id),
          eq(s.crtAttempts.memberId, actor.id),
          eq(s.crtAttempts.kind, "practice"),
        ),
      );
    const [row] = await (lock ? query.for("update") : query);
    if (
      !row ||
      row.questions.some(
        (q) => !assignedTopics.some((v) => v.topicId === q.topicId),
      )
    )
      throw new NotFoundException(
        "Practice session not found or its topics are no longer assigned.",
      );
    return row;
  }
  async practiceSession(actor: Actor, id: string): Promise<CrtPracticeSession> {
    return this.service.scope(actor, async (tx) =>
      this.session(await this.ownedPractice(tx, actor, id)),
    );
  }
  async submitPractice(
    actor: Actor,
    id: string,
    raw: z.infer<typeof crtPracticeSubmitInput>,
  ): Promise<CrtResult> {
    const input = crtPracticeSubmitInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      const row = await this.ownedPractice(tx, actor, id, true);
      if (row.result) return row.result;
      const result = this.result(id, row.questions, input.answers, 100);
      await tx
        .update(s.crtAttempts)
        .set({
          answers: input.answers,
          result,
          submittedAt: new Date(result.submittedAt),
        })
        .where(eq(s.crtAttempts.id, id));
      return result;
    });
  }
  async practiceImage(actor: Actor, id: string, uploadId: string) {
    await this.service.scope(actor, async (tx) => {
      const row = await this.ownedPractice(tx, actor, id);
      if (!row.questions.some((q) => q.image?.uploadId === uploadId))
        throw new NotFoundException(
          "Image not found in this practice session.",
        );
    });
    return new LessonService(
      this.service,
      this.service.lessonStorage,
    ).authorizedQuestionImage(actor, uploadId);
  }
}
