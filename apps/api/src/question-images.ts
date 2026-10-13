import { BadRequestException } from "@nestjs/common";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { QuestionImage } from "@slate/contracts";
import type { Transaction } from "./database.js";
import * as s from "./schema.js";

export const questionImageInput = z
  .object({
    uploadId: z.string().uuid(),
    alt: z.string().trim().min(1).max(500),
  })
  .strict();
export const questionImageTypes = ["image/png", "image/jpeg", "image/webp"];
export const maxQuestionImageBytes = 5 * 1024 * 1024;

// Validate the immutable object, never the browser-supplied filename/MIME alone.
export function matchesQuestionImageType(
  bytes: Uint8Array,
  contentType: string,
) {
  const starts = (signature: number[]) =>
    signature.every((b, i) => bytes[i] === b);
  if (contentType === "image/png")
    return starts([137, 80, 78, 71, 13, 10, 26, 10]);
  if (contentType === "image/jpeg") return starts([255, 216, 255]);
  if (contentType === "image/webp")
    return (
      starts([82, 73, 70, 70]) &&
      bytes.length >= 12 &&
      [87, 69, 66, 80].every((b, i) => bytes[i + 8] === b)
    );
  return false;
}

export async function validateQuestionImages(
  tx: Transaction,
  questions: { image?: QuestionImage }[],
) {
  const ids = [
    ...new Set(questions.flatMap((q) => (q.image ? [q.image.uploadId] : []))),
  ];
  if (!ids.length) return;
  const uploads = await tx
    .select()
    .from(s.lessonUploads)
    .where(inArray(s.lessonUploads.id, ids));
  if (
    ids.some(
      (id) =>
        !uploads.some(
          (upload) =>
            upload.id === id &&
            upload.purpose === "question_image" &&
            upload.status === "ready" &&
            upload.objectKey &&
            questionImageTypes.includes(upload.contentType) &&
            upload.size <= maxQuestionImageBytes,
        ),
    )
  )
    throw new BadRequestException(
      "Finish uploading each question image before saving or publishing.",
    );
}
