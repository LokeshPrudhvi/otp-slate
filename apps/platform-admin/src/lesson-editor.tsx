import { useCallback, useEffect, useRef, useState } from "react";
import { getLessonVideoSource, type Lesson, type LessonFile, type LessonQuestion, type LessonSubmission } from "@slate/contracts";
import {
  DataState, Empty, ErrorMessage, Field, LessonContent, Panel, QuestionImageEditor, QuestionImageView, RichTextEditor,
  downloadLessonFile, uploadLessonFile, useData,
} from "@slate/ui";
import { AdminSelect } from "./select";
import "./lesson-editor.css";

type LessonKind = NonNullable<Lesson["kind"]>;
const lessonTypes: { kind: LessonKind; name: string; symbol: string; detail: string }[] = [
  { kind: "text", name: "Reading", symbol: "Aa", detail: "Formatted text, lists and code" },
  { kind: "video", name: "Video", symbol: "▷", detail: "A video link or uploaded file" },
  { kind: "assignment", name: "Assignment", symbol: "↗", detail: "Written work, links and files" },
  { kind: "quiz", name: "MCQ assignment", symbol: "✓", detail: "Questions with automatic scoring" },
];
const typeFor = (lesson: Lesson) => lessonTypes.find(item => item.kind === (lesson.kind || "text"))!;
const newQuestion = (): LessonQuestion => ({ id: crypto.randomUUID(), prompt: "", options: ["", ""], correctOption: 0, explanation: "" });
const newLesson = (kind: LessonKind): Lesson => changeKind({ id: crypto.randomUUID(), title: "", body: "", format: "markdown" }, kind);
function changeKind(lesson: Lesson, kind: LessonKind): Lesson {
  const { video, assignment, quiz, ...base } = lesson;
  return { ...base, kind,
    ...(kind === "video" ? { video: video || { url: "" } } : {}),
    ...(kind === "assignment" ? { assignment: assignment || { acceptText: true, acceptLink: true, acceptFiles: true } } : {}),
    ...(kind === "quiz" ? { quiz: quiz || { passingScore: 70, questions: [newQuestion()] } } : {}),
  };
}
function webLink(value: string) {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
export function lessonValidation(lesson: Lesson): string | null {
  if (!lesson.title.trim()) return "Add a lesson title.";
  if (lesson.body.length > 100_000) return "Keep the lesson description below 100,000 characters.";
  const kind = lesson.kind || "text";
  if (kind === "text" && !lesson.body.trim()) return "Add reading content.";
  if (kind === "video" && !lesson.video?.uploadId && !getLessonVideoSource(lesson.video?.url || "")) return "Use an HTTPS YouTube, Vimeo, MP4 or WebM link, or upload a video.";
  if (kind === "assignment" && !lesson.body.trim()) return "Add assignment instructions.";
  if (kind === "assignment" && !Object.values(lesson.assignment || {}).some(Boolean)) return "Allow at least one submission method.";
  if (kind === "quiz") {
    const quiz = lesson.quiz;
    if (!quiz?.questions.length) return "Add at least one MCQ question.";
    if (!Number.isInteger(quiz.passingScore) || quiz.passingScore < 1 || quiz.passingScore > 100) return "Set a passing score from 1 to 100%.";
    for (const [index, question] of quiz.questions.entries()) {
      if (!question.prompt.trim()) return `Add the question text for question ${index + 1}.`;
      if (question.image && (!question.image.alt.trim() || question.image.alt.length > 500)) return `Add an image description of up to 500 characters for question ${index + 1}.`;
      if (question.options.length < 2 || question.options.length > 6 || question.options.some(option => !option.trim())) return `Complete all answer options for question ${index + 1}.`;
      if (question.correctOption === undefined || question.correctOption < 0 || question.correctOption >= question.options.length) return `Choose the correct answer for question ${index + 1}.`;
    }
  }
  return null;
}

export function CourseLessonBuilder({ courseId, lessons, onChange, disabled, readOnly, onUploadStateChange }: {
  courseId: string; lessons: Lesson[]; onChange: (lessons: Lesson[]) => void;
  disabled: boolean; readOnly: boolean; onUploadStateChange: (pending: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState(lessons[0]?.id || "");
  const [preview, setPreview] = useState(readOnly);
  const [addMenu, setAddMenu] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pendingUploads = useRef(new Set<string>());
  const reportUpload = useCallback((key: string, pending: boolean) => {
    if (pending) pendingUploads.current.add(key); else pendingUploads.current.delete(key);
    const active = pendingUploads.current.size > 0;
    setUploading(active);
    onUploadStateChange(active);
  }, [onUploadStateChange]);
  useEffect(() => {
    if (!lessons.some(lesson => lesson.id === selectedId)) setSelectedId(lessons[0]?.id || "");
  }, [lessons, selectedId]);
  useEffect(() => { if (readOnly) setPreview(true); }, [readOnly]);
  const selected = lessons.find(lesson => lesson.id === selectedId);
  const index = lessons.findIndex(lesson => lesson.id === selectedId);
  const locked = disabled || uploading;
  const update = (lesson: Lesson) => onChange(lessons.map(item => item.id === lesson.id ? lesson : item));
  const select = (id: string) => { setSelectedId(id); setRemoveConfirm(false); };
  const add = (kind: LessonKind) => {
    const lesson = newLesson(kind);
    onChange([...lessons, lesson]); setSelectedId(lesson.id); setPreview(false); setAddMenu(false); setRemoveConfirm(false);
  };
  const move = (direction: -1 | 1) => {
    const items = [...lessons];
    [items[index], items[index + direction]] = [items[index + direction], items[index]];
    onChange(items);
  };
  return <section className="course-lesson-builder" aria-label="Course lessons">
    <aside className="course-lesson-outline">
      <div className="course-outline-heading"><div><h2>Course outline</h2><p>{lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}</p></div><span className="admin-count">{lessons.filter(lesson => !lessonValidation(lesson)).length} ready</span></div>
      <ol>
        {lessons.map((lesson, itemIndex) => <li key={lesson.id}>
          <button type="button" className={`course-outline-item${lesson.id === selectedId ? " selected" : ""}`} disabled={locked} aria-current={lesson.id === selectedId ? "step" : undefined} onClick={() => select(lesson.id)}>
            <span className="course-outline-number">{String(itemIndex + 1).padStart(2, "0")}</span>
            <span className="course-outline-copy"><strong>{lesson.title.trim() || "Untitled lesson"}</strong><small>{typeFor(lesson).name}</small></span>
            {lessonValidation(lesson) && !readOnly && <span className="course-lesson-incomplete" aria-label="Needs content" title="Needs content" />}
          </button>
        </li>)}
      </ol>
      {!readOnly && <div className="course-outline-add">
        <button type="button" className="btn" disabled={locked || lessons.length >= 200} aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)}>+ Add lesson</button>
        {addMenu && <div className="course-add-menu" role="group" aria-label="New lesson type">{lessonTypes.map(item => <button type="button" key={item.kind} disabled={locked} onClick={() => add(item.kind)}><span aria-hidden="true">{item.symbol}</span>{item.name}</button>)}</div>}
        <p>Arrange lessons in the order students will complete them.</p>
      </div>}
    </aside>
    <div className="course-lesson-workspace">
      {selected ? <>
        <div className="course-lesson-toolbar">
          <div><span className="course-editor-eyebrow">Lesson {index + 1}</span><strong>{preview ? "Lesson preview" : "Create a learning experience"}</strong></div>
          <div className="course-editor-mode" role="group" aria-label="Lesson display mode">
            {!readOnly && <button type="button" disabled={locked} aria-pressed={!preview} onClick={() => setPreview(false)}>Edit</button>}
            <button type="button" disabled={locked} aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
          </div>
        </div>
        {preview ? <LessonPreview key={selected.id} lesson={selected} /> : <div className="course-lesson-fields">
          <Field label="Lesson title"><input required maxLength={150} value={selected.title} disabled={locked} placeholder="Give this lesson a clear, descriptive title" onChange={event => update({ ...selected, title: event.target.value })} /></Field>
          <fieldset className="course-lesson-types" disabled={locked}><legend>Lesson type</legend><div>{lessonTypes.map(item => <button type="button" key={item.kind} aria-pressed={(selected.kind || "text") === item.kind} onClick={() => update(changeKind(selected, item.kind))}><span className="course-type-symbol" aria-hidden="true">{item.symbol}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span></button>)}</div></fieldset>
          {(selected.kind === "video") && <VideoLessonEditor key={selected.id} courseId={courseId} lesson={selected} onChange={update} disabled={disabled} onPending={pending => reportUpload(`video:${selected.id}`, pending)} />}
          <RichTextEditor label={selected.kind === "assignment" ? "Assignment instructions" : selected.kind === "quiz" ? "Introduction & instructions" : selected.kind === "video" ? "Video description & notes" : "Lesson content"} value={selected.body} format={selected.format || "plain"} disabled={locked} onChange={(body: string) => update({ ...selected, body, format: "markdown" })} />
          {selected.kind === "assignment" && <AssignmentEditor lesson={selected} onChange={update} disabled={locked} />}
          {selected.kind === "quiz" && <QuizEditor lesson={selected} onChange={update} disabled={locked} onPending={reportUpload} />}
        </div>}
        {!readOnly && <div className="course-lesson-footer">
          <div className="actions"><button type="button" className="btn" disabled={locked || index === 0} onClick={() => move(-1)} aria-label="Move lesson earlier">↑ Move up</button><button type="button" className="btn" disabled={locked || index === lessons.length - 1} onClick={() => move(1)} aria-label="Move lesson later">↓ Move down</button></div>
          <button type="button" className="text-button course-remove-lesson" disabled={locked || lessons.length === 1} aria-expanded={removeConfirm} onClick={() => setRemoveConfirm(!removeConfirm)}>Remove lesson</button>
          {removeConfirm && <div className="course-remove-confirm" role="group" aria-label="Confirm lesson removal"><p>Remove “{selected.title || "Untitled lesson"}” from the next version? Previously published versions and student progress stay unchanged.</p><div className="actions"><button type="button" className="btn danger" disabled={locked} onClick={() => { onChange(lessons.filter(lesson => lesson.id !== selected.id)); setRemoveConfirm(false); }}>Remove from this version</button><button type="button" className="btn" onClick={() => setRemoveConfirm(false)}>Keep lesson</button></div></div>}
        </div>}
      </> : <Empty title="Build your first lesson">Choose a reading, video, assignment or MCQ assignment to get started.</Empty>}
    </div>
  </section>;
}

function VideoLessonEditor({ courseId, lesson, onChange, disabled, onPending }: { courseId: string; lesson: Lesson; onChange: (lesson: Lesson) => void; disabled: boolean; onPending: (pending: boolean) => void }) {
  const [source, setSource] = useState<"link" | "upload">(lesson.video?.uploadId ? "upload" : "link");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [uploaded, setUploaded] = useState<LessonFile | null>(null);
  const upload = async (file: File) => {
    setError(null);
    if (!/\.(mp4|webm)$/i.test(file.name) || file.size <= 0 || file.size > 250 * 1024 * 1024) {
      setError(new Error("Choose an MP4 or WebM video up to 250 MB.")); return;
    }
    setPending(true); onPending(true); setProgress(0);
    try {
      const saved = await uploadLessonFile(file, { purpose: "video", courseId, lessonId: lesson.id }, setProgress);
      setUploaded(saved); onChange({ ...lesson, video: { uploadId: saved.id } });
    } catch (error) { setError(error instanceof Error ? error : new Error("The video could not be uploaded. Please retry.")); }
    finally { setPending(false); onPending(false); }
  };
  return <div className="course-video-settings">
    <div className="course-editor-mode" role="group" aria-label="Video source"><button type="button" aria-pressed={source === "link"} disabled={disabled || pending} onClick={() => setSource("link")}>Video link</button><button type="button" aria-pressed={source === "upload"} disabled={disabled || pending} onClick={() => setSource("upload")}>Upload video</button></div>
    {source === "link" ? <Field label="Video URL"><input type="url" maxLength={2000} placeholder="https://www.youtube.com/watch?v=…" value={lesson.video?.url || ""} disabled={disabled || pending} onChange={event => { setUploaded(null); onChange({ ...lesson, video: { url: event.target.value } }); }} /><small>Use an HTTPS YouTube, Vimeo, MP4 or WebM link. Make sure students can view the linked video.</small></Field> : <div className="course-video-upload">
      <span className="course-type-symbol" aria-hidden="true">↑</span><strong>{lesson.video?.uploadId ? uploaded?.fileName || "Video uploaded" : "Add a video from your computer"}</strong><p>MP4 or WebM · up to 250 MB</p>
      {uploaded && <small>{formatBytes(uploaded.size)}</small>}
      <label className={`btn${pending || disabled ? " disabled" : ""}`}><input type="file" accept="video/mp4,video/webm,.mp4,.webm" disabled={disabled || pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /><span>{pending ? `Uploading ${Math.round(progress)}%…` : lesson.video?.uploadId ? "Replace video" : "Choose video"}</span></label>
      {pending && <progress value={progress} max={100} aria-label="Video upload progress" />}
      {lesson.video?.uploadId && <button type="button" className="text-button" disabled={disabled || pending} onClick={() => { setUploaded(null); onChange({ ...lesson, video: { url: "" } }); }}>Remove uploaded video</button>}
    </div>}
    {source === "link" && lesson.video?.uploadId && <p className="course-editor-hint">The uploaded video is currently selected. Enter a link to replace it.</p>}
    {source === "upload" && lesson.video?.url && <p className="course-editor-hint">The current video link is kept until your upload finishes.</p>}
    <ErrorMessage error={error} />
  </div>;
}

function AssignmentEditor({ lesson, onChange, disabled }: { lesson: Lesson; onChange: (lesson: Lesson) => void; disabled: boolean }) {
  const methods = lesson.assignment || { acceptText: true, acceptLink: true, acceptFiles: true };
  return <fieldset className="course-assignment-settings" disabled={disabled}><legend>Accepted submission formats</legend><p>Students can use one or more of the formats you allow.</p><div>{([
    ["acceptText", "Written answer", "An answer entered directly in the lesson"],
    ["acceptLink", "Project or repository link", "A project, GitHub repository or shared document"],
    ["acceptFiles", "File upload", "Supporting documents submitted privately"],
  ] as const).map(([key, label, description]) => <label key={key} className={methods[key] ? "selected" : ""}><input type="checkbox" checked={methods[key]} onChange={event => onChange({ ...lesson, assignment: { ...methods, [key]: event.target.checked } })} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</div><small>At least one format is required. Submitting work marks the assignment complete.</small></fieldset>;
}

function QuizEditor({ lesson, onChange, disabled, onPending }: { lesson: Lesson; onChange: (lesson: Lesson) => void; disabled: boolean; onPending: (key: string, pending: boolean) => void }) {
  const quiz = lesson.quiz || { passingScore: 70, questions: [] };
  const updateQuestion = (question: LessonQuestion) => onChange({ ...lesson, quiz: { ...quiz, questions: quiz.questions.map(item => item.id === question.id ? question : item) } });
  const removeOption = (question: LessonQuestion, index: number) => updateQuestion({ ...question, options: question.options.filter((_, i) => i !== index), correctOption: question.correctOption === index ? undefined : question.correctOption !== undefined && question.correctOption > index ? question.correctOption - 1 : question.correctOption });
  return <div className="course-quiz-settings">
    <div className="course-quiz-heading"><div><h3>MCQ questions</h3><p>Choose one correct answer per question. Students receive a score after submitting.</p></div><Field label="Passing score (%)"><input type="number" required min={1} max={100} step={1} disabled={disabled} value={quiz.passingScore} onChange={event => onChange({ ...lesson, quiz: { ...quiz, passingScore: Number(event.target.value) } })} /></Field></div>
    {quiz.questions.map((question, index) => <fieldset className="course-question" key={question.id} disabled={disabled}>
      <legend>Question {index + 1}</legend>
      <Field label="Question"><textarea required rows={2} maxLength={5000} placeholder="What would you like to ask?" value={question.prompt} onChange={event => updateQuestion({ ...question, prompt: event.target.value })} /></Field>
      <QuestionImageEditor image={question.image} disabled={disabled} label={`Question ${index + 1} image`} onChange={image => updateQuestion({ ...question, image })} onPending={pending => onPending(`question:${question.id}`, pending)} />
      <p className="course-question-label">Answer options <span>Select the circle beside the correct answer</span></p>
      {question.options.map((option, optionIndex) => <div className={`course-question-option${question.correctOption === optionIndex ? " correct" : ""}`} key={optionIndex}>
        <input type="radio" name={`correct-${lesson.id}-${question.id}`} checked={question.correctOption === optionIndex} onChange={() => updateQuestion({ ...question, correctOption: optionIndex })} aria-label={`Mark option ${String.fromCharCode(65 + optionIndex)} as correct for question ${index + 1}`} />
        <span aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span><input required maxLength={2000} aria-label={`Question ${index + 1}, option ${String.fromCharCode(65 + optionIndex)}`} placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`} value={option} onChange={event => updateQuestion({ ...question, options: question.options.map((item, i) => i === optionIndex ? event.target.value : item) })} />
        <button type="button" className="course-icon-button" disabled={question.options.length <= 2} aria-label={`Remove option ${String.fromCharCode(65 + optionIndex)} from question ${index + 1}`} onClick={() => removeOption(question, optionIndex)}>×</button>
      </div>)}
      <div className="actions"><button type="button" className="text-button" disabled={question.options.length >= 6} onClick={() => updateQuestion({ ...question, options: [...question.options, ""] })}>+ Add option</button><span className="course-editor-hint">2–6 options · one correct answer</span></div>
      <Field label="Answer explanation (optional)"><textarea rows={2} maxLength={5000} value={question.explanation || ""} placeholder="Explain why the answer is correct" onChange={event => updateQuestion({ ...question, explanation: event.target.value })} /></Field>
      <div className="course-question-actions"><button type="button" className="text-button course-remove-lesson" disabled={quiz.questions.length <= 1} onClick={() => onChange({ ...lesson, quiz: { ...quiz, questions: quiz.questions.filter(item => item.id !== question.id) } })}>Remove question</button></div>
    </fieldset>)}
    <button type="button" className="btn" disabled={disabled || quiz.questions.length >= 50} onClick={() => onChange({ ...lesson, quiz: { ...quiz, questions: [...quiz.questions, newQuestion()] } })}>+ Add question</button>
  </div>;
}

function LessonPreview({ lesson }: { lesson: Lesson }) {
  const source = getLessonVideoSource(lesson.video?.url || "");
  const [videoUrl, setVideoUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const loadVideo = async () => {
    setPending(true); setError(null);
    try { setVideoUrl((await downloadLessonFile(lesson.video!.uploadId!)).url); }
    catch (error) { setError(error instanceof Error ? error : new Error("The video could not be loaded.")); }
    finally { setPending(false); }
  };
  return <div className="course-lesson-preview">
    <span className="badge">{typeFor(lesson).name}</span><h2>{lesson.title || "Untitled lesson"}</h2>
    {lesson.kind === "video" && <div className="course-video-preview">
      {lesson.video?.uploadId ? videoUrl ? <video controls preload="metadata" src={videoUrl} aria-label={lesson.title} /> : <button type="button" className="btn" disabled={pending} onClick={() => void loadVideo()}>{pending ? "Loading video…" : "▷ Preview uploaded video"}</button> : source ? source.kind === "file" ? <video controls preload="metadata" src={source.url} aria-label={lesson.title} /> : <iframe src={source.url} title={lesson.title || "Lesson video"} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <p>Add a video to preview this lesson.</p>}
      <ErrorMessage error={error} />
    </div>}
    {lesson.body ? <LessonContent body={lesson.body} format={lesson.format} /> : <p className="course-editor-hint">{lesson.kind === "text" || !lesson.kind ? "Reading content will appear here." : "Add a description or instructions to introduce this lesson."}</p>}
    {lesson.kind === "assignment" && <div className="course-preview-assignment"><strong>Submit your work</strong><p>Available formats: {[
      lesson.assignment?.acceptText && "written answer", lesson.assignment?.acceptLink && "project link", lesson.assignment?.acceptFiles && "file upload",
    ].filter(Boolean).join(", ") || "Choose at least one submission format"}.</p><button type="button" className="btn primary" disabled>Submit assignment</button><small>Preview only · submissions are made in the student portal.</small></div>}
    {lesson.kind === "quiz" && <div className="course-preview-quiz"><div className="note">Admin preview · correct answers are marked below. Students see answers only after submitting.</div><p>Passing score: <strong>{lesson.quiz?.passingScore ?? 70}%</strong></p>{lesson.quiz?.questions.map((question, index) => <div className="course-preview-question" key={question.id}><h3>{index + 1}. {question.prompt || "Question text"}</h3>{question.image && <QuestionImageView image={question.image} source={`lesson-uploads/${question.image.uploadId}/download`} label={`Question ${index + 1} image`} />}{question.options.map((option, i) => <div key={i} className={question.correctOption === i ? "correct" : ""}><span>{String.fromCharCode(65 + i)}</span>{option || "Answer option"}{question.correctOption === i && <small>Correct answer</small>}</div>)}{question.explanation && <p><strong>Explanation:</strong> {question.explanation}</p>}</div>)}</div>}
  </div>;
}

function formatBytes(bytes: number) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
function SubmissionFile({ file }: { file: LessonFile }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const open = async () => {
    setPending(true); setError(null);
    try { const { url } = await downloadLessonFile(file.id); const link = document.createElement("a"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); }
    catch (error) { setError(error instanceof Error ? error : new Error("The file could not be opened.")); }
    finally { setPending(false); }
  };
  return <div className="course-submission-file"><button type="button" className="btn" disabled={pending} onClick={() => void open()}>{pending ? "Preparing…" : `${file.fileName} ↗`}</button><small>{formatBytes(file.size)}</small><ErrorMessage error={error} /></div>;
}
export function CourseSubmissions({ courseId, lessons }: { courseId: string; lessons: Lesson[] }) {
  const data = useData<LessonSubmission[]>(`course-submissions-${courseId}`, `platform/courses/${courseId}/submissions`);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const submissions = data.data || [];
  const filtered = submissions.filter(item => (kind === "all" || item.kind === kind) && `${item.studentName} ${item.studentEmail} ${item.organizationName}`.toLowerCase().includes(search.toLowerCase().trim()));
  return <Panel title="Student submissions" action={<button type="button" className="btn" disabled={data.isFetching} onClick={() => void data.refetch()}>{data.isFetching ? "Refreshing…" : "Refresh"}</button>}>
    <p className="course-editor-hint">Review written work, submitted files and MCQ results across published course versions. The latest 200 submissions are shown.</p>
    <div className="admin-filterbar"><Field label="Search students"><input type="search" placeholder="Name, email or organization" value={search} onChange={event => setSearch(event.target.value)} /></Field><Field label="Submission type"><AdminSelect value={kind} onChange={setKind} aria-label="Submission type" options={[{ value: "all", label: "All submissions" }, { value: "assignment", label: "Assignments" }, { value: "quiz", label: "MCQ assignments" }]} /></Field><span className="admin-count">{filtered.length} submissions</span></div>
    <DataState pending={data.isPending} error={data.error}>
      {filtered.length ? <div className="course-submission-list">{filtered.map(submission => {
        const lesson = lessons.find(item => item.id === submission.lessonId);
        return <details key={submission.id} className="course-submission"><summary><span><strong>{submission.studentName || "Student"}</strong><small>{submission.studentEmail || ""} · {submission.organizationName || "Organization"}</small></span><span><strong>{submission.lessonTitle || lesson?.title || (submission.kind === "quiz" ? "MCQ assignment" : "Assignment")}</strong><small>{new Date(submission.submittedAt).toLocaleString()}</small></span><span className={`badge ${submission.kind === "quiz" ? submission.passed ? "green" : "amber" : "green"}`}>{submission.kind === "quiz" ? `${submission.score ?? 0}% · ${submission.passed ? "Passed" : "Not passed"}` : "Submitted"}</span></summary><div className="course-submission-content"><p className="course-editor-hint">Course version: {submission.versionNumber ? `Version ${submission.versionNumber}` : submission.versionId} · {submission.lessonTitle || "Assigned lesson"}</p>{submission.answer && <div className="course-written-answer"><h4>Written answer</h4><p>{submission.answer}</p></div>}{submission.url && webLink(submission.url) && <p><a href={submission.url} target="_blank" rel="noopener noreferrer">Open submitted project or repository ↗</a></p>}{submission.files.map(file => <SubmissionFile key={file.id} file={file} />)}{submission.kind === "quiz" && <div className="course-submission-results">{submission.quizResults.map((result, index) => {
          const question = submission.quizQuestions?.find(item => item.id === result.questionId);
          return <div key={result.questionId}><strong>{index + 1}. {question?.prompt || "Question"}</strong><span className={`badge ${result.selectedOption === result.correctOption ? "green" : "amber"}`}>{result.selectedOption === result.correctOption ? "Correct" : "Incorrect"}</span>{question?.image && <QuestionImageView image={question.image} source={`lesson-uploads/${question.image.uploadId}/download`} label={`Question ${index + 1} image`} />}<p>Selected: {String.fromCharCode(65 + result.selectedOption)}{question?.options[result.selectedOption] ? ` · ${question.options[result.selectedOption]}` : ""}</p><p>Correct: {String.fromCharCode(65 + result.correctOption)}{question?.options[result.correctOption] ? ` · ${question.options[result.correctOption]}` : ""}</p>{result.explanation && <p>{result.explanation}</p>}</div>;
        })}</div>}</div></details>;
      })}</div> : <Empty title={submissions.length ? "No matching submissions" : "Student work will appear here"}>{submissions.length ? "Try another student name or submission type." : "Publish an assignment or MCQ lesson. Submitted work and scores will appear here when students complete it."}</Empty>}
    </DataState>
  </Panel>;
}
