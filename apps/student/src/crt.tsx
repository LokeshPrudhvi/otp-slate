import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  crtSubjects,
  type CrtPracticeSession,
  type CrtResult,
  type CrtStudentTopic,
  type CrtStudentTopicDetail,
  type CrtSubjectId,
  type LessonQuestion,
} from "@slate/contracts";
import { api, QuestionImageView, Select, useMe } from "@slate/ui";
import { useStudentData } from "./access";
import { Status, StudentIcon } from "./design";
import "./crt.css";

const subjectDescriptions: Record<CrtSubjectId, string> = {
  quantitative: "Build fluency with numbers, percentages and problem solving.",
  reasoning: "Recognise patterns, connect ideas and reason through a problem.",
  verbal: "Strengthen your vocabulary, comprehension and communication.",
  "soft-skills":
    "Prepare for interviews, workplace conversations and your next opportunity.",
};
const topicPageSize = 20;

export function CrtPage() {
  const [params, setParams] = useSearchParams();
  const subjects = crtSubjects.map((subject) => subject.id as string);
  const requested = params.get("subject") || "quantitative";
  const selected =
    requested === "practice" || subjects.includes(requested)
      ? requested
      : "quantitative";
  const topicId = selected === "practice" ? null : params.get("topic");
  const topics = useStudentData<CrtStudentTopic[]>(
    "crt-topics",
    "student/crt/topics",
  );
  const completed = topics.data?.filter((topic) => topic.completed).length || 0;
  const changeTab = (subject: string) => setParams({ subject });
  return (
    <div className="crt-page">
      <header className="crt-hero">
        <div className="crt-hero-copy">
          <span className="crt-eyebrow">CAMPUS RECRUITMENT TRAINING</span>
          <h1>One topic closer to ready.</h1>
          <p>
            Read the concepts, put them into practice and build your confidence.
          </p>
        </div>
        <div className="crt-progress-summary">
          <StudentIcon name="practice" />
          <div>
            <strong>
              {completed}
              <span> / {topics.data?.length ?? "—"}</span>
            </strong>
            <span>topics completed</span>
          </div>
        </div>
        <nav className="crt-subjects" aria-label="CRT subjects">
          {crtSubjects.map((subject, index) => (
            <button
              type="button"
              key={subject.id}
              className={selected === subject.id ? "is-active" : ""}
              aria-current={selected === subject.id ? "page" : undefined}
              onClick={() => changeTab(subject.id)}
            >
              <span className="crt-tab-number">0{index + 1}</span>
              <span>{subject.name}</span>
            </button>
          ))}
          <button
            type="button"
            className={selected === "practice" ? "is-active" : ""}
            aria-current={selected === "practice" ? "page" : undefined}
            onClick={() => changeTab("practice")}
          >
            <StudentIcon name="practice" />
            <span>Practice</span>
          </button>
        </nav>
      </header>
      <main
        className="crt-content"
        aria-label={
          selected === "practice"
            ? "CRT practice"
            : crtSubjects.find((subject) => subject.id === selected)?.name
        }
      >
        <Status pending={topics.isPending} error={topics.error} />
        {topics.isError && (
          <button
            type="button"
            className="a-btn"
            onClick={() => void topics.refetch()}
          >
            Retry topics
          </button>
        )}
        {topics.data &&
          (selected === "practice" ? (
            <CrtPractice
              key={params.get("session") || "new"}
              topics={topics.data}
              sessionId={params.get("session")}
              onSession={(id) =>
                setParams({
                  subject: "practice",
                  ...(id ? { session: id } : {}),
                })
              }
            />
          ) : topicId ? (
            <TopicReader
              key={topicId}
              id={topicId}
              onBack={() => changeTab(selected)}
            />
          ) : (
            <TopicLibrary
              key={selected}
              subject={selected as CrtSubjectId}
              topics={topics.data.filter(
                (topic) => topic.subjectId === selected,
              )}
              onOpen={(topic) =>
                setParams({ subject: topic.subjectId, topic: topic.id })
              }
            />
          ))}
      </main>
    </div>
  );
}

export function TopicLibrary({
  subject,
  topics,
  onOpen,
}: {
  subject: CrtSubjectId;
  topics: CrtStudentTopic[];
  onOpen: (topic: CrtStudentTopic) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [show, setShow] = useState("all");
  const searchId = useId();
  const filtered = topics.filter(
    (topic) =>
      `${topic.title} ${topic.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (show === "all" ||
        (show === "completed" ? topic.completed : !topic.completed)),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / topicPageSize));
  const currentPage = Math.min(page, pages - 1);
  const completed = topics.filter((topic) => topic.completed).length;
  return (
    <section>
      <div className="crt-section-head">
        <div>
          <span className="crt-eyebrow">YOUR CURRICULUM</span>
          <h2>{crtSubjects.find((item) => item.id === subject)?.name}</h2>
          <p>{subjectDescriptions[subject]}</p>
        </div>
        <span className="crt-completion-count">
          {completed} of {topics.length} complete
        </span>
      </div>
      {topics.length > 0 ? (
        <>
          <div className="crt-library-tools">
            <label className="crt-search" htmlFor={searchId}>
              <span>Find a topic</span>
              <input
                id={searchId}
                type="search"
                placeholder="Search your topics…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label className="crt-filter">
              <span>Progress</span>
              <Select
                aria-label="Filter topics by progress"
                value={show}
                onChange={(value) => {
                  setShow(value);
                  setPage(0);
                }}
                options={[
                  { value: "all", label: "All topics" },
                  { value: "remaining", label: "To complete" },
                  { value: "completed", label: "Completed" },
                ]}
              />
            </label>
          </div>
          {filtered.length ? (
            <div className="crt-topic-grid">
              {filtered
                .slice(
                  currentPage * topicPageSize,
                  (currentPage + 1) * topicPageSize,
                )
                .map((topic, index) => (
                  <button
                    type="button"
                    className={`crt-topic-link${topic.completed ? " is-complete" : ""}`}
                    key={topic.id}
                    onClick={() => onOpen(topic)}
                    aria-label={`${topic.title}${topic.completed ? ", completed" : ""}`}
                  >
                    <span className="crt-topic-index">
                      {topic.completed ? (
                        <StudentIcon name="check" />
                      ) : (
                        String(
                          currentPage * topicPageSize + index + 1,
                        ).padStart(2, "0")
                      )}
                    </span>
                    <span>
                      <strong>{topic.title}</strong>
                      <small>
                        {topic.completed
                          ? "Completed"
                          : `${topic.questionCount} questions · Pass ${topic.passingScore}%`}
                      </small>
                    </span>
                    <span className="crt-topic-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ))}
            </div>
          ) : (
            <EmptyState
              title="No matching topics"
              text="Try another search or progress filter."
            />
          )}
          <footer className="crt-pagination">
            <span>
              {filtered.length
                ? `${currentPage * topicPageSize + 1}–${Math.min((currentPage + 1) * topicPageSize, filtered.length)} of ${filtered.length} topics`
                : "0 topics"}
            </span>
            <div>
              <button
                type="button"
                className="a-btn"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                ← Previous
              </button>
              <span>
                Page {currentPage + 1} of {pages}
              </span>
              <button
                type="button"
                className="a-btn"
                disabled={currentPage + 1 >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next →
              </button>
            </div>
          </footer>
        </>
      ) : (
        <EmptyState
          title="Your topics will appear here"
          text="Your placement team will assign topics to your organization and branch. Each topic includes a PDF and an assessment."
        />
      )}
    </section>
  );
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="crt-empty">
      <span>
        <StudentIcon name="courses" />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function TopicReader({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = useStudentData<CrtStudentTopicDetail>(
    `crt-topic-${id}`,
    `student/crt/topics/${id}`,
  );
  return (
    <section>
      <button type="button" className="crt-back" onClick={onBack}>
        ← All topics
      </button>
      <Status pending={detail.isPending} error={detail.error} />
      {detail.isError && (
        <button className="a-btn" onClick={() => void detail.refetch()}>
          Retry topic
        </button>
      )}
      {detail.data && (
        <TopicActivity
          key={detail.data.versionId}
          topic={detail.data}
          onRefresh={() => void detail.refetch()}
        />
      )}
    </section>
  );
}

function TopicActivity({
  topic,
  onRefresh,
}: {
  topic: CrtStudentTopicDetail;
  onRefresh: () => void;
}) {
  const query = useQueryClient();
  const me = useMe();
  const [answers, setAnswers] = useSavedAnswers(
    `topic:${me.data?.id}:${topic.versionId}`,
  );
  const [read, setRead] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const submit = useMutation({
    mutationFn: () =>
      api<CrtResult>(`student/crt/topics/${topic.id}/submit`, "POST", {
        versionId: topic.versionId,
        clientId,
        answers: currentAnswers(topic.questions, answers),
        readAcknowledged: read,
      }),
    onSuccess: () => {
      void query.invalidateQueries({ queryKey: ["student", "crt-topics"] });
      onRefresh();
    },
  });
  const retry = () => {
    submit.reset();
    setAnswers({});
    setClientId(crypto.randomUUID());
  };
  return (
    <>
      <div className="crt-section-head">
        <div>
          <span className="crt-eyebrow">
            READ & APPLY · VERSION {topic.version}
          </span>
          <h2>{topic.title}</h2>
          {topic.description && <p>{topic.description}</p>}
        </div>
        {topic.completed && (
          <span className="crt-completed-badge">
            <StudentIcon name="check" />
            Completed
          </span>
        )}
      </div>
      <div className="crt-reader-grid">
        <PdfReader topic={topic} />
        <section className="crt-assessment" aria-label="Topic assessment">
          <div className="crt-panel-heading">
            <div>
              <span className="crt-eyebrow">PUT IT INTO PRACTICE</span>
              <h3>Check your understanding</h3>
            </div>
            <span>{topic.questions.length} questions</span>
          </div>
          <p className="crt-assessment-note">
            Score at least <strong>{topic.passingScore}%</strong> to complete
            this topic. You can try again as often as you need.
          </p>
          {submit.data ? (
            <AssessmentResult
              result={submit.data}
              passingScore={topic.passingScore}
              imageSource={(imageId) =>
                `student/crt/topics/${topic.id}/images/${imageId}`
              }
              onRetry={retry}
            />
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (read && allAnswered(topic.questions, answers))
                  submit.mutate();
              }}
            >
              <Questions
                questions={topic.questions}
                answers={answers}
                onChange={setAnswers}
                disabled={submit.isPending}
                imageSource={(imageId) =>
                  `student/crt/topics/${topic.id}/images/${imageId}`
                }
              />
              <div className="crt-submit">
                <label className="crt-read-ack">
                  <input
                    type="checkbox"
                    checked={read}
                    disabled={submit.isPending}
                    onChange={(event) => setRead(event.target.checked)}
                  />
                  <span>I’ve read the PDF and I’m ready to submit.</span>
                </label>
                <Status error={submit.error} />
                <button
                  className="a-btn pri"
                  disabled={
                    submit.isPending ||
                    !read ||
                    !allAnswered(topic.questions, answers)
                  }
                >
                  {submit.isPending ? "Checking answers…" : "Submit assessment"}
                </button>
                <small>
                  {
                    Object.keys(answers).filter((key) =>
                      topic.questions.some((q) => q.id === key),
                    ).length
                  }{" "}
                  of {topic.questions.length} answered · Your draft answers stay
                  on this device.
                </small>
              </div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function PdfReader({ topic }: { topic: CrtStudentTopicDetail }) {
  const pdf = useStudentData<{ url: string; expiresIn: number }>(
    `crt-pdf-${topic.id}-${topic.versionId}`,
    `student/crt/topics/${topic.id}/pdf`,
  );
  const [expanded, setExpanded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!expanded || !dialog.current) return;
    const element = dialog.current;
    const trigger = button.current;
    element.showModal();
    return () => {
      if (element.open) element.close();
      trigger?.focus({ preventScroll: true });
    };
  }, [expanded]);
  const source = pdf.data?.url;
  return (
    <section className="crt-pdf-panel" aria-label="Topic PDF">
      <div className="crt-panel-heading">
        <div>
          <span className="crt-eyebrow">THE CONCEPTS</span>
          <h3>Read the lesson</h3>
        </div>
        <button
          ref={button}
          type="button"
          className="a-btn"
          disabled={!source}
          onClick={() => setExpanded(true)}
          aria-label="Enlarge lesson PDF"
        >
          ⤢ Expand
        </button>
      </div>
      <div className="crt-pdf-body">
        <Status pending={pdf.isPending} error={pdf.error} />
        {source && (
          <iframe
            src={source}
            title={`${topic.title} PDF`}
            referrerPolicy="no-referrer"
          />
        )}
      </div>
      <div className="crt-pdf-footer">
        <span title={topic.pdf.fileName}>{topic.pdf.fileName}</span>
        <button
          type="button"
          onClick={() => void pdf.refetch()}
          disabled={pdf.isFetching}
        >
          {pdf.isFetching ? "Refreshing…" : "Refresh PDF"}
        </button>
        {source && (
          <a href={source} target="_blank" rel="noopener noreferrer">
            Open PDF ↗
          </a>
        )}
      </div>
      {expanded && (
        <dialog
          ref={dialog}
          className="crt-pdf-dialog"
          aria-labelledby={titleId}
          onCancel={() => setExpanded(false)}
          onClose={() => setExpanded(false)}
        >
          <header>
            <strong id={titleId}>{topic.title}</strong>
            <button
              type="button"
              className="a-btn"
              autoFocus
              onClick={() => setExpanded(false)}
            >
              Close ×
            </button>
          </header>
          <iframe
            src={source}
            title={`${topic.title} expanded PDF`}
            referrerPolicy="no-referrer"
          />
        </dialog>
      )}
    </section>
  );
}

export function allAnswered(
  questions: LessonQuestion[],
  answers: Record<string, number>,
) {
  return (
    questions.length > 0 &&
    questions.every(
      (question) =>
        Number.isInteger(answers[question.id]) &&
        answers[question.id] >= 0 &&
        answers[question.id] < question.options.length,
    )
  );
}

function currentAnswers(
  questions: LessonQuestion[],
  answers: Record<string, number>,
) {
  return Object.fromEntries(
    questions.map((question) => [question.id, answers[question.id]]),
  );
}

/** Drafts are scoped to the signed-in student and immutable topic version/session. */
function useSavedAnswers(key: string) {
  const storageKey = `slate:crt-draft:${key}`;
  const [answers, setAnswers] = useState<Record<string, number>>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) || "{}");
      return stored && !Array.isArray(stored) && typeof stored === "object"
        ? (Object.fromEntries(
            Object.entries(stored).filter(
              ([, value]) =>
                typeof value === "number" && Number.isInteger(value),
            ),
          ) as Record<string, number>)
        : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {
      /* Private browsing may disable storage; the current attempt still works. */
    }
  }, [answers, storageKey]);
  return [answers, setAnswers] as const;
}

function Questions({
  questions,
  answers,
  onChange,
  disabled,
  imageSource,
}: {
  questions: LessonQuestion[];
  answers: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
  disabled: boolean;
  imageSource: (id: string) => string;
}) {
  const groupId = useId();
  return (
    <div className="crt-questions">
      {questions.map((question, index) => (
        <fieldset
          key={question.id}
          className="crt-question"
          disabled={disabled}
        >
          <legend>
            <span>Question {index + 1}</span>
            {question.prompt}
          </legend>
          {question.image && (
            <QuestionImageView
              image={question.image}
              source={imageSource(question.image.uploadId)}
              label={`Question ${index + 1} image`}
            />
          )}
          <div className="crt-answer-options">
            {question.options.map((option, optionIndex) => (
              <label
                key={optionIndex}
                className={
                  answers[question.id] === optionIndex ? "is-selected" : ""
                }
              >
                <input
                  type="radio"
                  name={`${groupId}-${question.id}`}
                  checked={answers[question.id] === optionIndex}
                  onChange={() =>
                    onChange({ ...answers, [question.id]: optionIndex })
                  }
                  value={optionIndex}
                />
                <span className="crt-option-letter" aria-hidden="true">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function AssessmentResult({
  result,
  passingScore,
  imageSource,
  onRetry,
}: {
  result: CrtResult;
  passingScore?: number;
  imageSource: (id: string) => string;
  onRetry: () => void;
}) {
  return (
    <div className="crt-results">
      <div
        className={`crt-result-banner${passingScore !== undefined && !result.passed ? " needs-practice" : ""}`}
        role="status"
      >
          <strong>{result.score}%</strong>
        <div>
          <h3>
            {passingScore === undefined
              ? "Practice complete"
              : result.passed
                ? "Topic completed"
                : "Keep practising—you’re getting there"}
          </h3>
          <p>
            {result.correct} of {result.total} correct
            {passingScore !== undefined
              ? ` · Passing score ${passingScore}%`
              : ""}
          </p>
        </div>
      </div>
      <button type="button" className="a-btn" onClick={onRetry}>
        {passingScore === undefined
          ? "Build another practice set"
          : "Try the assessment again"}
      </button>
      <h4>Review your answers</h4>
      {result.questions.map((question, index) => (
        <article key={question.id} className="crt-review">
          <div className="crt-review-heading">
            <strong>Question {index + 1}</strong>
            <span className={question.correct ? "correct" : "incorrect"}>
              {question.correct ? "✓ Correct" : "Review"}
            </span>
          </div>
          <p>{question.prompt}</p>
          {question.image && (
            <QuestionImageView
              image={question.image}
              source={imageSource(question.image.uploadId)}
              label={`Question ${index + 1} image`}
            />
          )}
          <p className="crt-your-answer">
            Your answer:{" "}
            <strong>
              {question.options[question.selectedOption] ?? "Not answered"}
            </strong>
          </p>
          {!question.correct && question.correctOption !== undefined && (
            <p className="crt-correct-answer">
              Correct answer:{" "}
              <strong>{question.options[question.correctOption]}</strong>
            </p>
          )}
          {question.explanation && (
            <p className="crt-explanation">{question.explanation}</p>
          )}
        </article>
      ))}
    </div>
  );
}

function CrtPractice({
  topics,
  sessionId,
  onSession,
}: {
  topics: CrtStudentTopic[];
  sessionId: string | null;
  onSession: (id: string | null) => void;
}) {
  const [subject, setSubject] = useState<CrtSubjectId | "">("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [count, setCount] = useState("10");
  const session = useStudentData<CrtPracticeSession>(
    `crt-practice-${sessionId}`,
    `student/crt/practice/${sessionId}`,
    Boolean(sessionId),
  );
  const create = useMutation({
    mutationFn: () =>
      api<CrtPracticeSession>("student/crt/practice", "POST", {
        ...(subject ? { subjectId: subject } : {}),
        ...(selectedTopic ? { topicIds: [selectedTopic] } : {}),
        count: Number(count),
      }),
    onSuccess: (data) => onSession(data.id),
  });
  const relevant = topics.filter(
    (topic) => !subject || topic.subjectId === subject,
  );
  const start = (event: FormEvent) => {
    event.preventDefault();
    if (relevant.length) create.mutate();
  };
  return (
    <section>
      <div className="crt-section-head">
        <div>
          <span className="crt-eyebrow">A LITTLE PRACTICE. EVERY DAY.</span>
          <h2>{sessionId ? "Your practice set" : "Choose what to work on"}</h2>
          <p>
            Questions from your assigned topics, plus extra practice added by
            your placement team.
          </p>
        </div>
        {sessionId && (
          <button
            type="button"
            className="a-btn"
            onClick={() => onSession(null)}
          >
            ← Practice setup
          </button>
        )}
      </div>
      {sessionId ? (
        <>
          <Status pending={session.isPending} error={session.error} />
          {session.isError && (
            <button
              type="button"
              className="a-btn"
              onClick={() => void session.refetch()}
            >
              Retry practice
            </button>
          )}
          {session.data && (
            <PracticeAttempt
              key={session.data.id}
              session={session.data}
              onAgain={() => onSession(null)}
            />
          )}
        </>
      ) : topics.length ? (
        <div className="crt-practice-setup">
          <form onSubmit={start}>
            <h3>Make it your practice</h3>
            <label>
              <span>Subject</span>
              <Select
                value={subject}
                onChange={(value) => {
                  setSubject(value as CrtSubjectId | "");
                  setSelectedTopic("");
                }}
                aria-label="Practice subject"
                options={[
                  { value: "", label: "All assigned subjects" },
                  ...crtSubjects.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                ]}
              />
            </label>
            <label>
              <span>Topic</span>
              <Select
                value={selectedTopic}
                onChange={setSelectedTopic}
                aria-label="Practice topic"
                searchable
                options={[
                  { value: "", label: "All assigned topics in this subject" },
                  ...relevant.map((topic) => ({
                    value: topic.id,
                    label: topic.title,
                  })),
                ]}
              />
            </label>
            <label>
              <span>Number of questions</span>
              <Select
                value={count}
                onChange={setCount}
                aria-label="Practice question count"
                options={[10, 20, 50].map((value) => ({
                  value: String(value),
                  label: `Up to ${value} questions`,
                }))}
              />
            </label>
            {!relevant.length && (
              <p className="crt-inline-note">
                No topics are assigned in this subject yet.
              </p>
            )}
            <Status error={create.error} />
            <button
              className="a-btn pri"
              disabled={create.isPending || !relevant.length}
            >
              {create.isPending ? "Preparing questions…" : "Start practising →"}
            </button>
          </form>
          <aside>
            <span className="crt-practice-illustration">
              <StudentIcon name="practice" />
            </span>
            <h3>Build confidence, one question at a time.</h3>
            <p>
              Take your time. Review explanations after you submit, then come
              back for another set.
            </p>
            <ul>
              <li>Mixed questions from your chosen topics</li>
              <li>Answers and explanations after submission</li>
              <li>Unlimited practice, with no timer</li>
            </ul>
            <p className="crt-inline-note">
              To earn a topic’s completion checkmark, submit its assessment
              alongside the PDF.
            </p>
          </aside>
        </div>
      ) : (
        <EmptyState
          title="Practice starts with your curriculum"
          text="Once your placement team assigns topics to your branch, you can practise those topics here."
        />
      )}
    </section>
  );
}

function PracticeAttempt({
  session,
  onAgain,
}: {
  session: CrtPracticeSession;
  onAgain: () => void;
}) {
  const me = useMe();
  const [answers, setAnswers] = useSavedAnswers(
    `practice:${me.data?.id}:${session.id}`,
  );
  const query = useQueryClient();
  const submit = useMutation({
    mutationFn: () =>
      api<CrtResult>(`student/crt/practice/${session.id}/submit`, "POST", {
        answers: currentAnswers(session.questions, answers),
      }),
    onSuccess: () => {
      void query.invalidateQueries({
        queryKey: ["student", `crt-practice-${session.id}`],
      });
    },
  });
  const result = submit.data || session.result;
  const imageSource = (id: string) =>
    `student/crt/practice/${session.id}/images/${id}`;
  return (
    <div className="crt-practice-attempt">
      {result ? (
        <AssessmentResult
          result={result}
          imageSource={imageSource}
          onRetry={onAgain}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (allAnswered(session.questions, answers)) submit.mutate();
          }}
        >
          <div className="crt-practice-count">
            <strong>{session.questions.length} questions</strong>
            <span>No timer · Progress at your pace</span>
          </div>
          <Questions
            questions={session.questions}
            answers={answers}
            onChange={setAnswers}
            disabled={submit.isPending}
            imageSource={imageSource}
          />
          <div className="crt-submit">
            <Status error={submit.error} />
            <button
              className="a-btn pri"
              disabled={
                submit.isPending || !allAnswered(session.questions, answers)
              }
            >
              {submit.isPending ? "Checking answers…" : "Submit practice"}
            </button>
            <small>
              {
                Object.keys(answers).filter((id) =>
                  session.questions.some((q) => q.id === id),
                ).length
              }{" "}
              of {session.questions.length} answered · Your draft answers stay
              on this device.
            </small>
          </div>
        </form>
      )}
    </div>
  );
}
