import { z } from "zod";
import { getLessonVideoSource } from "@slate/contracts";
import type { Lesson } from "@slate/contracts";
import { questionImageInput } from "./question-images.js";

const nonempty = (max: number) => z.string().trim().min(1).max(max);
export const secureUrl = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use an HTTPS link without embedded credentials.");
const question = z
  .object({
    id: nonempty(100),
    prompt: nonempty(5000),
    image: questionImageInput.optional(),
    options: z.array(nonempty(2000)).min(2).max(6),
    correctOption: z.number().int().min(0).max(5),
    explanation: z.string().trim().max(5000).optional(),
  })
  .strict()
  .refine(
    (value) => value.correctOption < value.options.length,
    "Choose a correct answer from the available options.",
  );
export const lessonInput = z
  .object({
    id: z.string().uuid().optional(),
    title: nonempty(150),
    body: z.string().trim().max(100_000),
    kind: z.enum(["text", "video", "assignment", "quiz"]).optional(),
    format: z.enum(["plain", "markdown"]).optional(),
    video: z
      .object({
        url: secureUrl
          .refine(
            (value) => getLessonVideoSource(value) !== null,
            "Use a YouTube, Vimeo, MP4 or WebM video link.",
          )
          .optional(),
        uploadId: z.string().uuid().optional(),
      })
      .strict()
      .optional(),
    assignment: z
      .object({
        acceptText: z.boolean(),
        acceptLink: z.boolean(),
        acceptFiles: z.boolean(),
      })
      .strict()
      .optional(),
    quiz: z
      .object({
        passingScore: z.number().int().min(1).max(100),
        questions: z.array(question).min(1).max(50),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const kind = value.kind || "text";
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (kind === "text" && !value.body)
      issue("Add lesson content before publishing.");
    if (
      kind === "video" &&
      (!value.video ||
        Number(Boolean(value.video.url)) +
          Number(Boolean(value.video.uploadId)) !==
          1)
    )
      issue("Choose a video link or one uploaded video.");
    if (
      kind === "assignment" &&
      (!value.body ||
        !value.assignment ||
        !Object.values(value.assignment).some(Boolean))
    )
      issue("Add assignment instructions and at least one submission method.");
    if (
      kind === "quiz" &&
      (!value.quiz ||
        new Set(value.quiz.questions.map((q) => q.id)).size !==
          value.quiz.questions.length)
    )
      issue("Add MCQ questions with unique identifiers.");
  })
  .transform((value) => {
    const { video, assignment, quiz, ...base } = value;
    return {
      ...base,
      ...(value.kind === "video" ? { video } : {}),
      ...(value.kind === "assignment" ? { assignment } : {}),
      ...(value.kind === "quiz" ? { quiz } : {}),
    };
  });
export type PublishLesson = z.infer<typeof lessonInput>;
export function redactLesson(lesson: Lesson): Lesson {
  if (!lesson.quiz) return lesson;
  return {
    ...lesson,
    quiz: {
      ...lesson.quiz,
      questions: lesson.quiz.questions.map(
        ({ correctOption, explanation, ...question }) => question,
      ),
    },
  };
}
export const uploadInput = z
  .object({
    purpose: z.enum(["video", "assignment", "question_image"]),
    fileName: nonempty(180).refine(
      (value) => !/[\x00-\x1f/\\]/.test(value),
      "Choose a valid file name.",
    ),
    contentType: nonempty(150),
    size: z.number().int().positive(),
    courseId: z.string().uuid().optional(),
    lessonId: z.string().uuid().optional(),
  })
  .strict();
export const submissionInput = z
  .object({
    versionId: z.string().uuid().optional(),
    answer: z.string().trim().max(50_000).optional(),
    url: secureUrl.optional(),
    uploadIds: z.array(z.string().uuid()).max(3).optional(),
    answers: z
      .record(z.string().max(100), z.number().int().min(0).max(5))
      .optional(),
  })
  .strict();
export type SubmissionInput = z.infer<typeof submissionInput>;
