import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  LessonFile,
  LessonSubmission,
  QuestionImage,
} from "@slate/contracts";
import type { z } from "zod";
import type { SlateService, Actor } from "./service.js";
import { r2LessonStorage, type LessonStorage } from "./lesson-storage.js";
import {
  submissionInput,
  uploadInput,
  type SubmissionInput,
} from "./lesson-input.js";
import * as s from "./schema.js";
import {
  matchesQuestionImageType,
  maxQuestionImageBytes,
  questionImageTypes,
} from "./question-images.js";

const file = (row: typeof s.lessonUploads.$inferSelect): LessonFile => ({
  id: row.id,
  fileName: row.fileName,
  contentType: row.contentType,
  size: row.size,
});
const publicSubmission = (
  row: typeof s.lessonSubmissions.$inferSelect,
): LessonSubmission => {
  const { organizationId, ...value } = row;
  return { ...value, submittedAt: row.submittedAt.toISOString() };
};
const types: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/webm": ["webm"],
  "application/pdf": ["pdf"],
  "text/plain": ["txt"],
  "application/zip": ["zip"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
};
export class LessonService {
  constructor(
    readonly service: SlateService,
    readonly storage: LessonStorage = r2LessonStorage,
  ) {}
  private requireStorage() {
    if (!this.storage.configured())
      throw new ServiceUnavailableException(
        "Private file storage is not configured yet. Use a video link or written/link assignment until storage is connected.",
      );
  }
  private async assigned(actor: Actor, courseId: string, lessonId: string) {
    if (actor.role !== "student")
      throw new ForbiddenException("Student access is required.");
    const course = await this.service.course(actor, courseId, undefined, true);
    const lesson = course.lessons.find((item) => item.id === lessonId);
    if (!course.versionId || !lesson)
      throw new NotFoundException(
        "Lesson not found in your assigned course version.",
      );
    return { course, lesson };
  }
  async createUpload(actor: Actor, raw: z.infer<typeof uploadInput>) {
    const input = uploadInput.parse(raw);
    let versionId: string | undefined;
    if (input.purpose === "video" || input.purpose === "question_image") {
      if (actor.role !== "platform_admin") throw new ForbiddenException();
      if (input.courseId || input.lessonId)
        throw new BadRequestException(
          "Content uploads must not include assignment identifiers.",
        );
    } else {
      if (!input.courseId || !input.lessonId)
        throw new BadRequestException(
          "Choose an assignment lesson before uploading.",
        );
      const { course, lesson } = await this.assigned(
        actor,
        input.courseId,
        input.lessonId,
      );
      if (lesson.kind !== "assignment" || !lesson.assignment?.acceptFiles)
        throw new ForbiddenException(
          "This lesson does not accept file submissions.",
        );
      versionId = course.versionId;
    }
    const isVideo = input.purpose === "video";
    const isImage = input.purpose === "question_image";
    const allowedType = isVideo
      ? ["video/mp4", "video/webm"].includes(input.contentType)
      : isImage
        ? questionImageTypes.includes(input.contentType)
        : Object.keys(types)
            .filter((type) => !type.startsWith("video/"))
            .includes(input.contentType);
    if (
      !allowedType ||
      !types[input.contentType]?.includes(
        input.fileName.split(".").at(-1)!.toLowerCase(),
      )
    )
      throw new BadRequestException(
        isVideo
          ? "Upload an MP4 or WebM video."
          : isImage
            ? "Upload a PNG, JPG or WebP image."
            : "Upload a PDF, TXT, ZIP, PNG, JPG or DOCX file.",
      );
    if (input.size > (isVideo ? 250 : isImage ? 5 : 10) * 1024 * 1024)
      throw new BadRequestException(
        `The file must be ${isVideo ? 250 : isImage ? 5 : 10} MB or smaller.`,
      );
    this.requireStorage();
    const uploadId = randomUUID();
    const stagingKey = `lesson-staging/${actor.id}/${uploadId}`;
    const uploadUrl = await this.storage.upload(
      stagingKey,
      input.contentType,
      input.size,
    );
    const [upload] = await this.service.scope(actor, (tx) =>
      tx
        .insert(s.lessonUploads)
        .values({
          id: uploadId,
          ownerId: actor.id,
          organizationId: isVideo || isImage ? null : actor.organizationId,
          purpose: input.purpose,
          fileName: input.fileName,
          contentType: input.contentType,
          size: input.size,
          stagingKey,
          courseId: input.courseId,
          lessonId: input.lessonId,
          versionId,
        })
        .returning(),
    );
    return {
      upload: file(upload),
      uploadUrl,
      headers: { "Content-Type": input.contentType },
    };
  }
  async completeUpload(actor: Actor, id: string) {
    this.requireStorage();
    const [owned] = await this.service.scope(actor, (tx) =>
      tx.select().from(s.lessonUploads).where(eq(s.lessonUploads.id, id)),
    );
    if (!owned || owned.ownerId !== actor.id)
      throw new NotFoundException("Upload not found.");
    if (owned.purpose === "assignment") {
      const { course, lesson } = await this.assigned(
        actor,
        owned.courseId!,
        owned.lessonId!,
      );
      if (
        course.versionId !== owned.versionId ||
        lesson.kind !== "assignment" ||
        !lesson.assignment?.acceptFiles
      )
        throw new ConflictException(
          "This assignment changed or no longer accepts files. Reload the lesson before uploading.",
        );
    }
    return this.service.scope(actor, async (tx) => {
      const [upload] = await tx
        .select()
        .from(s.lessonUploads)
        .where(eq(s.lessonUploads.id, id))
        .for("update");
      if (!upload || upload.ownerId !== actor.id)
        throw new NotFoundException("Upload not found.");
      if (upload.status === "ready") return file(upload);
      if (upload.createdAt.getTime() < Date.now() - 24 * 3600_000)
        throw new BadRequestException(
          "This upload has expired. Upload the file again.",
        );
      let metadata: { size: number; contentType: string };
      try {
        metadata = await this.storage.head(upload.stagingKey);
      } catch {
        throw new BadRequestException(
          "The file has not finished uploading. Retry after the upload completes.",
        );
      }
      if (
        metadata.size !== upload.size ||
        metadata.contentType !== upload.contentType
      )
        throw new BadRequestException(
          "The uploaded file does not match its declared size or type.",
        );
      const objectKey = `lesson-assets/${upload.id}/${randomUUID()}`;
      await this.storage.finalize(upload.stagingKey, objectKey);
      // Verify the copied object, not just mutable staging metadata, before it becomes eligible for publication/submission.
      const final = await this.storage.head(objectKey);
      if (
        final.size !== upload.size ||
        final.contentType !== upload.contentType
      )
        throw new BadRequestException(
          "The uploaded file changed while being finalized. Upload it again.",
        );
      if (upload.purpose === "question_image") {
        if (!this.storage.readPrefix)
          throw new ServiceUnavailableException(
            "Image validation is not available. Try again later.",
          );
        const prefix = await this.storage.readPrefix(objectKey, 16);
        if (!matchesQuestionImageType(prefix, upload.contentType))
          throw new BadRequestException(
            "This file is not a valid PNG, JPG or WebP image matching its selected type. Upload the original image again.",
          );
      }
      await tx
        .update(s.lessonUploads)
        .set({ status: "ready", objectKey, readyAt: new Date() })
        .where(eq(s.lessonUploads.id, id));
      return file(upload);
    });
  }
  async download(actor: Actor, id: string) {
    if (!["platform_admin", "student"].includes(actor.role))
      throw new ForbiddenException();
    this.requireStorage();
    const [upload] = await this.service.scope(actor, (tx) =>
      tx.select().from(s.lessonUploads).where(eq(s.lessonUploads.id, id)),
    );
    if (
      !upload ||
      upload.status !== "ready" ||
      !upload.objectKey ||
      (actor.role !== "platform_admin" &&
        (upload.ownerId !== actor.id || upload.purpose !== "assignment"))
    )
      throw new NotFoundException("File not found.");
    if (actor.role === "student")
      await this.assigned(actor, upload.courseId!, upload.lessonId!);
    return {
      url: await this.storage.download(
        upload.objectKey,
        upload.fileName,
        upload.purpose === "assignment",
      ),
      expiresIn: upload.purpose === "assignment" ? 300 : 3600,
    };
  }
  async questionImage(
    actor: Actor,
    courseId: string,
    lessonId: string,
    uploadId: string,
  ) {
    const { lesson } = await this.assigned(actor, courseId, lessonId);
    if (
      lesson.kind !== "quiz" ||
      !lesson.quiz?.questions.some((q) => q.image?.uploadId === uploadId)
    )
      throw new NotFoundException(
        "This lesson has no matching question image.",
      );
    return this.authorizedQuestionImage(actor, uploadId);
  }
  // Internal service helper. The calling course, exam or practice service MUST
  // authorize the exact published question/owned attempt reference first.
  async authorizedQuestionImage(actor: Actor, uploadId: string) {
    this.requireStorage();
    const [upload] = await this.service.scope(actor, async (tx) => {
      await tx.execute(
        sql`select set_config('slate.question_image_id', ${uploadId}, true)`,
      );
      return tx
        .select()
        .from(s.lessonUploads)
        .where(eq(s.lessonUploads.id, uploadId));
    });
    if (
      !upload ||
      upload.purpose !== "question_image" ||
      upload.status !== "ready" ||
      !upload.objectKey ||
      !questionImageTypes.includes(upload.contentType) ||
      upload.size > maxQuestionImageBytes
    )
      throw new NotFoundException("Question image not found.");
    return {
      url: await this.storage.download(
        upload.objectKey,
        upload.fileName,
        false,
      ),
      expiresIn: 3600,
    };
  }
  async video(actor: Actor, courseId: string, lessonId: string) {
    const { lesson } = await this.assigned(actor, courseId, lessonId);
    if (lesson.kind !== "video" || !lesson.video?.uploadId)
      throw new NotFoundException("This lesson has no uploaded video.");
    this.requireStorage();
    const [upload] = await this.service.scope(actor, async (tx) => {
      await tx.execute(
        sql`select set_config('slate.lesson_upload_id', ${lesson.video!.uploadId!}, true)`,
      );
      return tx
        .select()
        .from(s.lessonUploads)
        .where(eq(s.lessonUploads.id, lesson.video!.uploadId!));
    });
    if (
      !upload ||
      upload.purpose !== "video" ||
      upload.status !== "ready" ||
      !upload.objectKey
    )
      throw new NotFoundException("Video not found.");
    return {
      url: await this.storage.download(
        upload.objectKey,
        upload.fileName,
        false,
      ),
      expiresIn: 3600,
    };
  }
  async submission(actor: Actor, courseId: string, lessonId: string) {
    const { course, lesson } = await this.assigned(actor, courseId, lessonId);
    if (lesson.kind !== "assignment" && lesson.kind !== "quiz")
      throw new BadRequestException("This lesson does not accept submissions.");
    const [row] = await this.service.scope(actor, (tx) =>
      tx
        .select()
        .from(s.lessonSubmissions)
        .where(
          and(
            eq(s.lessonSubmissions.memberId, actor.id),
            eq(s.lessonSubmissions.versionId, course.versionId!),
            eq(s.lessonSubmissions.lessonId, lessonId),
          ),
        ),
    );
    return row ? publicSubmission(row) : null;
  }
  async submit(
    actor: Actor,
    courseId: string,
    lessonId: string,
    raw: SubmissionInput,
  ) {
    const input = submissionInput.parse(raw);
    const { course, lesson } = await this.assigned(actor, courseId, lessonId);
    if (input.versionId && input.versionId !== course.versionId)
      throw new ConflictException(
        "Your assigned course version changed. Reload the lesson before submitting.",
      );
    if (lesson.kind !== "assignment" && lesson.kind !== "quiz")
      throw new BadRequestException("This lesson does not accept submissions.");
    const value = {
      organizationId: actor.organizationId!,
      memberId: actor.id,
      courseId,
      versionId: course.versionId!,
      lessonId,
      kind: lesson.kind,
      answer: "",
      url: "",
      files: [] as LessonFile[],
      score: null as number | null,
      passed: null as boolean | null,
      quizResults: [] as LessonSubmission["quizResults"],
      submittedAt: new Date(),
    };
    if (lesson.kind === "quiz") {
      if (
        input.answer ||
        input.url ||
        input.uploadIds?.length ||
        !input.answers ||
        !lesson.quiz
      )
        throw new BadRequestException("Answer each MCQ question.");
      const questions = lesson.quiz.questions;
      if (
        Object.keys(input.answers).length !== questions.length ||
        questions.some(
          (q) =>
            input.answers![q.id] === undefined ||
            input.answers![q.id] >= q.options.length ||
            q.correctOption === undefined,
        )
      )
        throw new BadRequestException(
          "Answer every question using its available options.",
        );
      value.quizResults = questions.map((q) => ({
        questionId: q.id,
        selectedOption: input.answers![q.id],
        correctOption: q.correctOption!,
        ...(q.explanation ? { explanation: q.explanation } : {}),
      }));
      value.score = Math.round(
        (value.quizResults.filter((q) => q.selectedOption === q.correctOption)
          .length /
          questions.length) *
          100,
      );
      value.passed = value.score >= lesson.quiz.passingScore;
    } else {
      const settings = lesson.assignment;
      if (
        !settings ||
        input.answers ||
        (input.answer && !settings.acceptText) ||
        (input.url && !settings.acceptLink) ||
        (input.uploadIds?.length && !settings.acceptFiles)
      )
        throw new BadRequestException(
          "Use one of the submission methods allowed for this assignment.",
        );
      if (!input.answer && !input.url && !input.uploadIds?.length)
        throw new BadRequestException(
          "Add a written answer, link or file before submitting.",
        );
      value.answer = input.answer || "";
      value.url = input.url || "";
    }
    return this.service.scope(actor, async (tx) => {
      if (lesson.kind === "assignment" && input.uploadIds?.length) {
        if (new Set(input.uploadIds).size !== input.uploadIds.length)
          throw new BadRequestException("Each attachment must be unique.");
        const files = await tx
          .select()
          .from(s.lessonUploads)
          .where(inArray(s.lessonUploads.id, input.uploadIds));
        if (
          files.length !== input.uploadIds.length ||
          files.some(
            (item) =>
              item.ownerId !== actor.id ||
              item.purpose !== "assignment" ||
              item.status !== "ready" ||
              item.courseId !== courseId ||
              item.versionId !== course.versionId ||
              item.lessonId !== lessonId,
          )
        )
          throw new BadRequestException(
            "Only your completed uploads for this assigned lesson may be submitted.",
          );
        value.files = files.map(file);
      }
      const [saved] = await tx
        .insert(s.lessonSubmissions)
        .values(value)
        .onConflictDoUpdate({
          target: [
            s.lessonSubmissions.memberId,
            s.lessonSubmissions.versionId,
            s.lessonSubmissions.lessonId,
          ],
          set: value,
        })
        .returning();
      if (lesson.kind === "assignment" || value.passed)
        await tx
          .insert(s.progress)
          .values({
            organizationId: actor.organizationId!,
            memberId: actor.id,
            versionId: course.versionId!,
            lessonId,
          })
          .onConflictDoNothing();
      await this.service.log(
        tx,
        actor,
        "lesson.submitted",
        actor.organizationId,
        saved.id,
      );
      return publicSubmission(saved);
    });
  }
  async review(actor: Actor, courseId: string) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    await this.service.course(actor, courseId);
    return this.service.scope(actor, async (tx) => {
      const rows = await tx
        .select({
          submission: s.lessonSubmissions,
          studentName: s.user.name,
          studentEmail: s.user.email,
          organizationName: s.organizations.name,
          versionNumber: s.versions.number,
          submittedLesson: sql<{
            title: string;
            quiz?: {
              questions: {
                id: string;
                prompt: string;
                options: string[];
                image?: QuestionImage;
              }[];
            };
          } | null>`(select jsonb_build_object('title', item->>'title', 'quiz', item->'quiz') from jsonb_array_elements(${s.versions.lessons}) item where item->>'id'=${s.lessonSubmissions.lessonId} limit 1)`,
        })
        .from(s.lessonSubmissions)
        .innerJoin(s.versions, eq(s.versions.id, s.lessonSubmissions.versionId))
        .innerJoin(s.members, eq(s.members.id, s.lessonSubmissions.memberId))
        .innerJoin(s.user, eq(s.user.id, s.members.authUserId))
        .innerJoin(
          s.organizations,
          eq(s.organizations.id, s.lessonSubmissions.organizationId),
        )
        .where(eq(s.lessonSubmissions.courseId, courseId))
        .orderBy(desc(s.lessonSubmissions.submittedAt))
        .limit(200);
      return rows.map(({ submission, submittedLesson, ...student }) => ({
        ...publicSubmission(submission),
        ...student,
        lessonTitle: submittedLesson?.title || "Untitled lesson",
        ...(submittedLesson?.quiz
          ? {
              quizQuestions: submittedLesson.quiz.questions.map(
                ({ id, prompt, options, image }) => ({
                  id,
                  prompt,
                  options,
                  ...(image ? { image } : {}),
                }),
              ),
            }
          : {}),
      }));
    });
  }
}
