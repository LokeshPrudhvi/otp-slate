import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crtSubjects, type CrtTopicDetail, type CrtTopicDraft, type CrtSubjectId, type LessonFile, type LessonQuestion } from "@slate/contracts";
import { api, DataState, ErrorMessage, Field, Panel, downloadLessonFile, uploadLessonFile, useData } from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import { CrtQuestionEditor, newCrtQuestion, validateCrtQuestion } from "./crt-questions";
import "./crt.css";

const emptyDraft = (): CrtTopicDraft => ({ title: "", subjectId: "quantitative", description: "", passingScore: 70, questions: [newCrtQuestion()] });
const draftFrom = (topic: CrtTopicDetail): CrtTopicDraft => ({ title: topic.title, subjectId: topic.subjectId, description: topic.description, passingScore: topic.passingScore, pdfUploadId: topic.pdfUploadId, questions: topic.questions });

export function validateCrtTopic(draft: CrtTopicDraft, publish: boolean): string | null {
  if (!draft.title.trim()) return "Add a topic title.";
  if (!Number.isInteger(draft.passingScore) || draft.passingScore < 1 || draft.passingScore > 100) return "Set a passing score between 1 and 100%.";
  if (!publish) return null;
  if (!draft.pdfUploadId) return "Upload a PDF before publishing this topic.";
  if (!draft.questions.length) return "Add at least one assessment question before publishing.";
  for (const [index, question] of draft.questions.entries()) {
    const error = validateCrtQuestion(question, index);
    if (error) return error;
  }
  return null;
}

export function CrtTopicEditor() {
  const { id } = useParams();
  const navigate = useNavigate(), client = useQueryClient();
  const topic = useData<CrtTopicDetail>(`crt:topic:${id}`, `platform/crt/topics/${id}`, Boolean(id));
  const [draft, setDraft] = useState<CrtTopicDraft>(emptyDraft);
  const [saved, setSaved] = useState<CrtTopicDetail | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState("");
  const [file, setFile] = useState<LessonFile | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | Error>("");
  const [notice, setNotice] = useState("");
  const [publishConfirm, setPublishConfirm] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const loaded = useRef("");
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (topic.data && loaded.current !== topic.data.id) {
      loaded.current = topic.data.id; setDraft(draftFrom(topic.data)); setSaved(topic.data); setFile(topic.data.pdf);
    }
  }, [topic.data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ? draftFrom(saved) : { title: "", subjectId: "quantitative", description: "", passingScore: 70, questions: [] });
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const activeQuestion = draft.questions.find(question => question.id === selectedQuestion) ?? draft.questions[0];
  const activeIndex = activeQuestion ? draft.questions.findIndex(question => question.id === activeQuestion.id) : 0;
  const pending = (key: string, active: boolean) => setPendingKeys(keys => active ? [...new Set([...keys, key])] : keys.filter(item => item !== key));
  const change = (value: Partial<CrtTopicDraft>) => { setDraft(current => ({ ...current, ...value })); setNotice(""); setError(""); setPublishConfirm(false); };
  const refresh = async (result: CrtTopicDetail) => {
    setSaved(result); setDraft(draftFrom(result)); setFile(result.pdf); loaded.current = result.id;
    client.setQueryData(["platform", `crt:topic:${result.id}`], result);
    await client.invalidateQueries({ queryKey: ["platform", "crt:topics"] });
  };
  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const validation = validateCrtTopic(draft, publish); if (validation) throw new Error(validation);
      const persistedId = saved?.id || id;
      let result = saved && !dirty ? saved : await api<CrtTopicDetail>(persistedId ? `platform/crt/topics/${persistedId}` : "platform/crt/topics", persistedId ? "PATCH" : "POST", { ...draft, ...(persistedId ? { revision: saved?.revision } : {}) });
      // Keep the saved revision even if a later publish request needs a retry.
      await refresh(result);
      if (publish) result = await api<CrtTopicDetail>(`platform/crt/topics/${result.id}/publish`, "POST", { revision: result.revision });
      return result;
    },
    onSuccess: async (result, publish) => {
      await refresh(result); setPublishConfirm(false); setNotice(publish ? `Version ${result.version} published. Assign it to an organization and branch when ready.` : "Draft saved.");
      if (!id) navigate(`/crt/topics/${result.id}`, { replace: true });
    },
  });
  const busy = save.isPending || pendingKeys.length > 0;
  const upload = async (selected: File) => {
    pending("pdf", true); setError(""); setUploadProgress(0);
    try {
      const value = await uploadLessonFile(selected, { purpose: "crt_pdf" }, progress => { if (mounted.current) setUploadProgress(progress); });
      if (mounted.current) { setFile(value); change({ pdfUploadId: value.id }); setPreviewUrl(""); }
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught : new Error("The PDF could not upload.")); }
    finally { if (mounted.current) pending("pdf", false); }
  };
  const previewPdf = async () => {
    if (!draft.pdfUploadId) return;
    pending("preview", true); setError("");
    try { const result = await downloadLessonFile(draft.pdfUploadId); if (mounted.current) setPreviewUrl(result.url); }
    catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught : new Error("The PDF preview could not load.")); }
    finally { if (mounted.current) pending("preview", false); }
  };
  const submit = (publish: boolean) => { setError(""); setNotice(""); save.reset(); save.mutate(publish); };
  const updateQuestion = (question: LessonQuestion) => change({ questions: draft.questions.map(item => item.id === question.id ? question : item) });
  return <AdminPage title={id ? "Edit CRT topic" : "Create CRT topic"} description="Pair a reading PDF with an assessment. Set the score students need to complete this topic." className="crt-admin crt-editor" action={<Link className="btn" to="/crt">← CRT curriculum</Link>}>
    <DataState pending={Boolean(id) && topic.isPending} error={topic.error}>
      <form noValidate onSubmit={event => { event.preventDefault(); submit(false); }}>
        {notice && <p className="success-note" role="status">{notice}</p>}
        <ErrorMessage error={error ? error instanceof Error ? error : new Error(error) : save.error} />
        {saved?.version ? <div className="crt-version-note"><span className="badge green">Published v{saved.version}</span><p>Changes create a new version. Branches keep their assigned version and student progress until you update their assignments.</p><Link to="/crt?tab=assignments">Manage assignments →</Link></div> : <div className="crt-version-note"><span className="badge">Draft topic</span><p>Save your work as you go. Publishing makes the topic ready to assign.</p></div>}
        <div className="crt-editor-details">
          <Panel title="Topic details"><fieldset disabled={busy} className="crt-form-fields">
            <Field label="Topic title"><input required maxLength={150} value={draft.title} placeholder="e.g. Percentages and percentage change" onChange={event => change({ title: event.target.value })} /></Field>
            <Field label="Subject"><AdminSelect aria-label="CRT subject" value={draft.subjectId} disabled={busy || Boolean(saved?.version)} onChange={value => change({ subjectId: value as CrtSubjectId })} options={crtSubjects.map(item => ({ value: item.id, label: item.name }))} /></Field>
            <Field label="Short introduction"><textarea rows={3} maxLength={2000} value={draft.description} placeholder="What will students learn in this topic?" onChange={event => change({ description: event.target.value })} /></Field>
            <Field label="Passing score (%)" hint="Students can retry. Meeting this score adds a completion checkmark to the topic."><input type="number" min={1} max={100} step={1} required value={draft.passingScore} onChange={event => change({ passingScore: Number(event.target.value) })} /></Field>
          </fieldset></Panel>
          <Panel title="Reading PDF"><div className={`crt-pdf-upload${draft.pdfUploadId ? " has-file" : ""}`}><span className="crt-pdf-symbol" aria-hidden="true">PDF</span><strong>{draft.pdfUploadId ? file?.fileName || "PDF attached" : "Add the topic reading"}</strong><p>Students read this beside the assessment.<br />PDF · up to 20 MB</p><label className={`btn${busy ? " disabled" : ""}`}><input type="file" accept="application/pdf,.pdf" aria-label={draft.pdfUploadId ? "Replace topic PDF" : "Upload topic PDF"} disabled={busy} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void upload(selected); }} /><span>{pendingKeys.includes("pdf") ? `Uploading ${uploadProgress}%…` : draft.pdfUploadId ? "Replace PDF" : "Choose PDF"}</span></label>
            {pendingKeys.includes("pdf") && <progress value={uploadProgress} max={100} aria-label="PDF upload progress" />}
            {draft.pdfUploadId && <div className="actions"><button className="text-button" type="button" disabled={busy} onClick={() => previewUrl ? setPreviewUrl("") : void previewPdf()}>{previewUrl ? "Hide PDF preview" : "Preview PDF"}</button><button className="text-button crt-remove" type="button" disabled={busy} onClick={() => { change({ pdfUploadId: undefined }); setFile(null); setPreviewUrl(""); }}>Remove PDF</button></div>}
          </div>{previewUrl && <iframe className="crt-admin-pdf-preview" title="Topic reading preview" src={previewUrl} referrerPolicy="no-referrer" />}</Panel>
        </div>
        <section className="panel crt-assessment-editor"><div className="panel-head"><div><h2>Topic assessment</h2><p className="crt-panel-description">Questions are also available in student practice.</p></div><span className="admin-count">{draft.questions.length} questions</span></div><div className="crt-assessment-layout"><aside className="crt-question-outline" aria-label="Assessment question list">
          {draft.questions.map((question, index) => <button key={question.id} type="button" className={question.id === activeQuestion?.id ? "selected" : ""} aria-current={question.id === activeQuestion?.id ? "step" : undefined} disabled={busy} onClick={() => setSelectedQuestion(question.id)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{question.prompt.trim() || "New question"}</strong>{validateCrtQuestion(question, index) && <small aria-label="Incomplete">•</small>}</button>)}
          <button className="btn" type="button" disabled={busy || draft.questions.length >= 100} onClick={() => { const question = newCrtQuestion(); change({ questions: [...draft.questions, question] }); setSelectedQuestion(question.id); }}>+ Add question</button>
        </aside><div className="crt-question-workspace">{activeQuestion ? <CrtQuestionEditor key={activeQuestion.id} question={activeQuestion} index={activeIndex} onChange={updateQuestion} onRemove={() => change({ questions: draft.questions.filter(item => item.id !== activeQuestion.id) })} disabled={busy} onPending={active => pending(`image:${activeQuestion.id}`, active)} /> : <p className="muted">Add a question to build the topic assessment.</p>}</div></div></section>
        <div className="crt-editor-save"><div><strong>{dirty ? "You have unsaved changes" : "Draft is up to date"}</strong><p>{pendingKeys.length ? "Wait for uploads to finish before saving." : "Publishing does not change any branch’s current assignments."}</p></div><div className="actions"><button className="btn" type="submit" disabled={busy || (!dirty && Boolean(saved))}>{save.isPending && !save.variables ? "Saving…" : "Save draft"}</button><button className="btn primary" type="button" disabled={busy || saved?.status === "published" && !dirty} onClick={() => { const validation = validateCrtTopic(draft, true); if (validation) { setError(validation); return; } setError(""); setPublishConfirm(true); }}>{save.isPending && save.variables ? "Publishing…" : saved?.version ? "Publish new version" : "Publish topic"}</button></div>
          {publishConfirm && <div className="crt-publish-confirm" role="group" aria-label="Confirm topic publication"><p>Publish “{draft.title}” with {draft.questions.length} questions and a {draft.passingScore}% passing score? You can assign this version to specific branches after publishing.</p><div className="actions"><button type="button" className="btn primary" disabled={busy} onClick={() => submit(true)}>Confirm publish</button><button type="button" className="btn" disabled={busy} onClick={() => setPublishConfirm(false)}>Keep editing</button></div></div>}
        </div>
      </form>
    </DataState>
  </AdminPage>;
}
