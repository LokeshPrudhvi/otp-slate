import type { LessonFile } from "@slate/contracts";
import { api } from "./kit";

const documentTypes: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain", zip: "application/zip",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export async function uploadLessonFile(
  file: File,
  scope: { purpose: "video" | "assignment" | "question_image" | "crt_pdf" | "course_cover"; courseId?: string; lessonId?: string },
  onProgress?: (percent: number) => void,
): Promise<LessonFile> {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const contentType = scope.purpose === "video"
    ? ({ mp4: "video/mp4", webm: "video/webm" } as Record<string, string>)[extension]
    : ["question_image", "course_cover"].includes(scope.purpose)
      ? ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" } as Record<string, string>)[extension]
      : scope.purpose === "crt_pdf"
        ? extension === "pdf" ? "application/pdf" : undefined
        : documentTypes[extension];
  if (!contentType) throw new Error(scope.purpose === "video" ? "Choose an MP4 or WebM video." : ["question_image", "course_cover"].includes(scope.purpose) ? "Choose a PNG, JPEG or WebP image." : scope.purpose === "crt_pdf" ? "Choose a PDF document." : "Choose a PDF, text, ZIP, PNG, JPEG or DOCX file.");
  const megabytes = scope.purpose === "video" ? 250 : ["question_image", "course_cover"].includes(scope.purpose) ? 5 : scope.purpose === "crt_pdf" ? 20 : 10;
  const limit = megabytes * 1024 * 1024;
  if (file.size <= 0 || file.size > limit) throw new Error(`Choose a non-empty file of ${megabytes} MB or smaller.`);
  onProgress?.(0);
  const prepared = await api<{ upload: LessonFile; uploadUrl: string; headers: Record<string, string> }>("lesson-uploads", "POST", {
    ...scope, fileName: file.name, contentType, size: file.size,
  });
  const target = new URL(prepared.uploadUrl);
  if (target.protocol !== "https:" || target.username || target.password) throw new Error("The upload location is unavailable. Please retry.");
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", target.href);
    request.withCredentials = false;
    request.timeout = 15 * 60_000;
    for (const [name, value] of Object.entries(prepared.headers || { "Content-Type": contentType })) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(Math.min(95, Math.round(event.loaded / event.total * 95))); };
    request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error("The file could not be uploaded. Please retry."));
    request.onerror = () => reject(new Error("Upload connection failed. Check your connection and try again."));
    request.ontimeout = () => reject(new Error("The upload timed out. Please try again."));
    request.send(file);
  });
  const verified = await api<LessonFile>(`lesson-uploads/${prepared.upload.id}/complete`, "POST", {});
  onProgress?.(100);
  return verified;
}

export function downloadLessonFile(id: string) {
  return api<{ url: string; expiresIn: number }>(`lesson-uploads/${id}/download`);
}
