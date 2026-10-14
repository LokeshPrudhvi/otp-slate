import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { crtSubjects, type CrtBankQuestion, type CrtTopic, type LessonQuestion } from "@slate/contracts";
import { api, DataState, Empty, ErrorMessage, Field, Panel, useData } from "@slate/ui";
import { AdminSelect } from "./select";
import { AdminPagination } from "./shell";
import { CrtQuestionEditor, newCrtQuestion, validateCrtQuestion } from "./crt-questions";

export function CrtPracticeBank({ topics, topicsPending, topicsError }: { topics: CrtTopic[]; topicsPending: boolean; topicsError: unknown }) {
  const [subject, setSubject] = useState<string>(crtSubjects[0].id);
  const [topicId, setTopicId] = useState("");
  const topic = topics.find(item => item.id === topicId && item.subjectId === subject);
  return <><div className="crt-assignment-heading"><div><h2>Extra practice questions</h2><p>Supplement each topic’s assessment with more questions for repeat practice.</p></div><div className="crt-audience-controls">
    <Field label="Subject"><AdminSelect aria-label="Practice bank subject" value={subject} onChange={value => { setSubject(value); setTopicId(""); }} options={crtSubjects.map(item => ({ value: item.id, label: item.name }))} /></Field>
    <Field label="Topic"><AdminSelect aria-label="Practice bank topic" searchable value={topic?.id || ""} onChange={setTopicId} placeholder="Select a topic" disabled={topicsPending} options={topics.filter(item => item.subjectId === subject).map(item => ({ value: item.id, label: item.title }))} /></Field>
  </div></div><DataState pending={topicsPending} error={topicsError}>{topic ? <PracticeQuestions key={topic.id} topic={topic} /> : <Empty title="Choose a topic to add practice">Extra questions appear only for students assigned that topic. Topic assessment questions join the practice pool automatically.</Empty>}</DataState></>;
}

function PracticeQuestions({ topic }: { topic: CrtTopic }) {
  const query = useData<CrtBankQuestion[]>(`crt:bank:${topic.id}`, `platform/crt/topics/${topic.id}/questions`);
  const [editing, setEditing] = useState<CrtBankQuestion | null>(null);
  const [draft, setDraft] = useState<LessonQuestion | null>(null);
  const [uploading, setUploading] = useState(false);
  const [validation, setValidation] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const rows = query.data || [], currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  const save = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Add a question first.");
      const error = validateCrtQuestion(draft); if (error) throw new Error(error);
      return api<CrtBankQuestion>(editing ? `platform/crt/questions/${editing.id}` : `platform/crt/topics/${topic.id}/questions`, editing ? "PATCH" : "POST", { question: draft, ...(editing ? { revision: editing.revision, active: editing.active } : {}) });
    },
    onSuccess: async () => { setNotice(editing ? "Practice question updated." : "Practice question added."); setDraft(null); setEditing(null); await query.refetch(); },
  });
  const visibility = useMutation({ mutationFn: (question: CrtBankQuestion) => api<CrtBankQuestion>(`platform/crt/questions/${question.id}`, "PATCH", { question: question.question, active: !question.active, revision: question.revision }), onSuccess: async (result) => { setNotice(result.active ? "Question restored to practice." : "Question hidden from new practice sessions. Earlier answers are preserved."); await query.refetch(); } });
  const busy = save.isPending || visibility.isPending || uploading;
  return <>
    {notice && <p className="success-note" role="status">{notice}</p>}
    {!topic.versionId && <p className="note">This topic is a draft. Its practice questions become available after the topic is published and assigned. <Link to={`/crt/topics/${topic.id}`}>Edit topic →</Link></p>}
    <div className={`crt-bank-layout${draft ? " has-editor" : ""}`}>
      <Panel title={`Practice bank · ${topic.title}`} action={<button className="btn primary" type="button" disabled={busy || Boolean(draft)} onClick={() => { setDraft(newCrtQuestion()); setEditing(null); setValidation(""); setNotice(""); save.reset(); }}>+ Add question</button>}>
        <p className="crt-panel-description">Topic assessments are included automatically · {rows.filter(item => item.active).length} active extra questions</p>
        <ErrorMessage error={visibility.error} /><DataState pending={query.isPending} error={query.error}>{rows.length ? <><div className="crt-bank-list">{rows.slice((currentPage - 1) * 8, currentPage * 8).map((item, index) => <article key={item.id} className={item.active ? "" : "inactive"}><div><span className="crt-bank-number">{(currentPage - 1) * 8 + index + 1}</span><div><strong>{item.question.prompt}</strong><small>{item.question.options.length} options{item.question.image ? " · Includes image" : ""} · {item.active ? "Active" : "Hidden"}</small></div></div><div className="actions"><button className="text-button" type="button" disabled={busy || Boolean(draft)} onClick={() => { setEditing(item); setDraft(structuredClone(item.question)); setValidation(""); setNotice(""); save.reset(); }}>Edit</button><button className="text-button" type="button" disabled={busy || Boolean(draft)} onClick={() => visibility.mutate(item)}>{visibility.isPending && visibility.variables?.id === item.id ? "Updating…" : item.active ? "Hide from practice" : "Restore"}</button></div></article>)}</div><AdminPagination page={currentPage} total={rows.length} size={8} onChange={setPage} /></> : <Empty title="Give students more ways to practice">Add extra MCQs for this topic. They supplement the topic assessment without changing its passing score.</Empty>}</DataState>
      </Panel>
      {draft && <Panel title={editing ? "Edit practice question" : "New practice question"}><form onSubmit={event => { event.preventDefault(); const error = validateCrtQuestion(draft); if (error) { setValidation(error); return; } setValidation(""); save.mutate(); }}>
        <p className="crt-bank-save-note">Saving updates the practice pool for branches assigned this topic. Topic assessments and earlier practice attempts stay unchanged.</p>
        <CrtQuestionEditor question={draft} index={0} onChange={value => { setDraft(value); setValidation(""); }} disabled={busy} onPending={setUploading} />
        <ErrorMessage error={validation ? new Error(validation) : save.error} /><div className="actions crt-bank-editor-actions"><button className="btn primary" type="submit" disabled={busy}>{save.isPending ? "Saving…" : editing ? "Update question" : "Add to practice bank"}</button><button className="btn" type="button" disabled={busy} onClick={() => { setDraft(null); setEditing(null); setValidation(""); }}>Cancel</button></div>
      </form></Panel>}
    </div>
  </>;
}
