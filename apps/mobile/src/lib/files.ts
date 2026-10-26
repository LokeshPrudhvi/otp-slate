import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import type { LessonFile } from "@slate/contracts";
import { api } from "./api";
export async function pickAssignmentFile(
  courseId: string,
  lessonId: string,
): Promise<LessonFile | null> {
  const selection = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: [
      "application/pdf",
      "text/plain",
      "application/zip",
      "image/png",
      "image/jpeg",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  });
  if (selection.canceled) return null;
  const asset = selection.assets[0],
    file = new File(asset.uri);
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a non-empty assignment file of 10 MB or smaller.");
  const prepared = await api<{
    upload: LessonFile;
    uploadUrl: string;
    headers: Record<string, string>;
  }>("lesson-uploads", "POST", {
    purpose: "assignment",
    courseId,
    lessonId,
    fileName: asset.name,
    contentType: asset.mimeType || file.type,
    size: file.size,
  });
  const url = new URL(prepared.uploadUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid upload destination.");
  const response = await nativeFetch(url.href, {
    method: "PUT",
    credentials: "omit",
    headers: prepared.headers,
    body: file,
  });
  if (!response.ok)
    throw new Error(
      "Upload failed. Your existing answer is unchanged. Please retry.",
    );
  return api<LessonFile>(
    `lesson-uploads/${prepared.upload.id}/complete`,
    "POST",
    {},
  );
}
