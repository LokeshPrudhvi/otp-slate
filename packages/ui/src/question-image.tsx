import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { QuestionImage } from "@slate/contracts";
import { api, usePortal } from "./kit";
import { uploadLessonFile } from "./lesson-upload";
import "./question-image.css";

export function QuestionImageView({ image, source, label = "Question image" }: {
  image: QuestionImage;
  source: string;
  label?: string;
}) {
  const portal = usePortal();
  const [broken, setBroken] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const data = useQuery({
    queryKey: [portal, "question-image", source, image.uploadId],
    queryFn: async ({ signal }) => {
      const result = await api<{ url: string; expiresIn: number }>(source, "GET", undefined, signal);
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("The image could not be loaded.");
      return result;
    },
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => { setBroken(false); setExpanded(false); }, [source, image.uploadId]);
  useEffect(() => { setBroken(false); }, [data.dataUpdatedAt]);
  useEffect(() => {
    const element = dialog.current;
    if (!expanded || !element) return;
    const opener = trigger.current;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [expanded]);
  const failed = data.isError || broken;
  const retry = async () => {
    setBroken(false);
    await data.refetch();
  };
  return <figure className="question-image-view">
    {data.isPending || data.isFetching && failed ? <div className="question-image-notice" role="status">Loading image…</div> : failed ? <div className="question-image-notice" role="alert"><span>Image unavailable. {image.alt}</span><button type="button" onClick={() => void retry()}>Retry image</button></div> : data.data && <>
      <button ref={trigger} className="question-image-open" type="button" aria-label={`Enlarge ${label.toLowerCase()}`} onClick={() => setExpanded(true)}>
        <img src={data.data.url} alt={image.alt || label} onError={() => setBroken(true)} referrerPolicy="no-referrer" />
        <span aria-hidden="true">⤢ Enlarge image</span>
      </button>
      {expanded && <dialog ref={dialog} className="question-image-dialog" aria-labelledby={titleId} onClose={() => setExpanded(false)} onCancel={() => setExpanded(false)} onKeyDown={event => { if (event.key === "Escape" || event.key === "Tab") event.stopPropagation(); }} onClick={event => { if (event.target === event.currentTarget) setExpanded(false); }}>
        <div className="question-image-dialog-head"><strong id={titleId}>{label}</strong><button type="button" autoFocus aria-label="Close enlarged image" onClick={() => setExpanded(false)}>Close ×</button></div>
        <div className="question-image-full"><img src={data.data.url} alt={image.alt || label} referrerPolicy="no-referrer" onError={() => { setExpanded(false); setBroken(true); }} /></div>
        <p>{image.alt}</p>
      </dialog>}
    </>}
  </figure>;
}

export function QuestionImageEditor({ image, onChange, disabled = false, onPending, label = "Question image" }: {
  image?: QuestionImage;
  onChange: (image: QuestionImage | undefined) => void;
  disabled?: boolean;
  onPending?: (pending: boolean) => void;
  label?: string;
}) {
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const descriptionId = useId();
  const mounted = useRef(true);
  const busy = useRef(false);
  const callbacks = useRef({ onChange, onPending, image });
  callbacks.current = { onChange, onPending, image };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (busy.current) callbacks.current.onPending?.(false);
    };
  }, []);
  const upload = async (file: File) => {
    if (busy.current) return;
    setError("");
    busy.current = true;
    setPending(true); setProgress(0);
    callbacks.current.onPending?.(true);
    try {
      const saved = await uploadLessonFile(file, { purpose: "question_image" }, value => { if (mounted.current) setProgress(value); });
      if (mounted.current) callbacks.current.onChange({ uploadId: saved.id, alt: callbacks.current.image?.alt || "" });
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "The image could not upload. Please retry.");
    } finally {
      busy.current = false;
      if (mounted.current) { setPending(false); callbacks.current.onPending?.(false); }
    }
  };
  return <section className={`question-image-editor${image ? " has-image" : ""}`} aria-label={label}>
    <div className="question-image-editor-head"><div><strong>{label} <small>Optional</small></strong><p>Add a diagram, chart or illustration. PNG, JPEG or WebP · automatically compressed before upload (up to 30 MB original).</p></div><div className="question-image-actions">
      <label className={`question-image-upload${disabled || pending ? " is-disabled" : ""}`}><input type="file" aria-label={image ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`} accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={disabled || pending} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void upload(selected); }} /><span>{pending ? `Uploading ${Math.round(progress)}%…` : image ? "Replace image" : "+ Add image"}</span></label>
      {image && <button type="button" disabled={disabled || pending} onClick={() => { setError(""); onChange(undefined); }}>Remove image</button>}
    </div></div>
    {pending && <progress value={progress} max={100} aria-label="Question image upload progress" />}
    {error && <p className="question-image-error" role="alert">{error}</p>}
    {image && <>
      <QuestionImageView image={image} source={`lesson-uploads/${image.uploadId}/download`} label={label} />
      <label className="question-image-description" htmlFor={descriptionId}>Image description<input id={descriptionId} required maxLength={500} value={image.alt} disabled={disabled || pending} placeholder="Describe the diagram and any labels students need." onChange={event => onChange({ ...image, alt: event.target.value })} /><small>Required for accessibility. Describe what is shown without giving away the answer.</small></label>
    </>}
  </section>;
}
