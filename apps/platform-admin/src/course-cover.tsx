import { useEffect, useId, useState } from "react";
import { ErrorMessage, Field, Icon, uploadLessonFile } from "@slate/ui";
import "./course-cover.css";

export function courseCoverValidation(value: string) {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol === "https:" && !url.username && !url.password && value.trim().length <= 2000) return null;
  } catch { /* The message below explains the accepted URL. */ }
  return "Use a public HTTPS image link without a username or password.";
}

export function CourseCoverField({ value, uploadId, onChange, onUploadChange, onPending, disabled = false, readOnly = false }: {
  value: string;
  uploadId: string | null;
  onChange: (value: string) => void;
  onUploadChange: (id: string | null) => void;
  onPending: (pending: boolean) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const helpId = useId();
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const [fileName, setFileName] = useState("");
  const normalized = value.trim();
  const issue = courseCoverValidation(value);
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const guard = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      event.preventDefault(); event.stopPropagation();
    };
    window.addEventListener("beforeunload", warn); document.addEventListener("click", guard, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", guard, true); };
  }, [pending]);
  const upload = async (file: File) => {
    if (pending || disabled || readOnly) return;
    setUploadError(null); setPending(true); onPending(true); setProgress(0);
    try {
      const saved = await uploadLessonFile(file, { purpose: "course_cover" }, setProgress);
      onChange(""); onUploadChange(saved.id); setFileName(saved.fileName);
    } catch (error) { setUploadError(error instanceof Error ? error : new Error("The cover image could not be uploaded. Please retry.")); }
    finally { setPending(false); onPending(false); }
  };
  return <div className="course-cover-editor">
    <div className="course-cover-fields">
      <Field label="Course cover image URL (optional)">
        <input type="url" maxLength={2000} placeholder="https://example.com/course-cover.jpg" value={value}
          disabled={disabled || pending} readOnly={readOnly} aria-describedby={helpId} aria-invalid={Boolean(issue)}
          onChange={event => { onChange(event.target.value); if (event.target.value.trim()) onUploadChange(null); }} />
      </Field>
      <p id={helpId}>Use a public image link or upload a landscape image. It appears on course cards in the student dashboard and catalog.</p>
      {!readOnly && <div className="course-cover-upload"><label className="btn"><input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" aria-label="Upload course cover image" disabled={disabled || pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><span>{pending ? progress ? `Uploading ${Math.round(progress)}%…` : "Optimizing image…" : uploadId ? "Replace uploaded image" : "Upload image"}</span></label><small>PNG, JPG or WebP · automatically compressed before upload (up to 30 MB original)</small></div>}
      {pending && <progress value={progress} max={100} aria-label="Course cover upload progress" />}
      {uploadId && <p className="course-cover-uploaded"><Icon name="book" />{fileName || "Uploaded cover image"}</p>}
      {issue && <p className="course-cover-error" role="alert">{issue}</p>}
      <ErrorMessage error={uploadError} />
      {(normalized || uploadId) && !readOnly && <button type="button" className="text-button" disabled={disabled || pending} onClick={() => { onChange(""); onUploadChange(null); setFileName(""); }}>Remove cover image</button>}
    </div>
  </div>;
}
