import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { CrtPracticeArt, CrtSubjectArt } from "./crt-card-art";
import "./crt.css";

const subjectDescriptions: Record<CrtSubjectId, string> = {
  quantitative: "Build fluency with numbers, percentages and problem solving.",
  reasoning: "Recognise patterns, connect ideas and reason through a problem.",
  verbal: "Strengthen your vocabulary, comprehension and communication.",
  "soft-skills":
    "Prepare for interviews, workplace conversations and your next opportunity.",
};

export function CrtPage() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("subject");
  const selected =
    requested === "practice" ||
    crtSubjects.some((subject) => subject.id === requested)
      ? requested
      : null;
  const topicId =
    selected && selected !== "practice" ? params.get("topic") : null;
  const topics = useStudentData<CrtStudentTopic[]>(
    "crt-topics",
    "student/crt/topics",
  );
  return (
    <div className={`crt-page${topicId ? " crt-page--topic" : ""}`}>
      <main
        className="crt-content"
        aria-label={
          !selected
            ? "CRT subjects"
            : selected === "practice"
              ? "CRT practice"
              : crtSubjects.find((subject) => subject.id === selected)?.name
        }
      >
        {selected && !topicId && (
          <Link className="crt-back crt-home-link" to="/crt">
            <span aria-hidden="true">←</span> All CRT subjects
          </Link>
        )}
        <Status
          pending={topics.isPending}
          error={topics.error}
          label="Loading your CRT curriculum"
          variant="cards"
        />
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
          (!selected ? (
            <SubjectCards topics={topics.data} />
          ) : selected === "practice" ? (
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
              onBack={() => setParams({ subject: selected })}
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

const subjectTaglines: Record<CrtSubjectId, string> = {
  quantitative: "Think in numbers",
  reasoning: "Connect the dots",
  verbal: "Find your words",
  "soft-skills": "Make an impression",
};

function SubjectCards({ topics }: { topics: CrtStudentTopic[] }) {
  return (
    <section aria-labelledby="crt-subject-heading">
      <div className="crt-section-head crt-landing-head">
        <div>
          <span className="crt-eyebrow">YOUR LEARNING PATH</span>
          <h1 id="crt-subject-heading">Campus Recruitment and Training</h1>
          <p>Explore a subject or revisit what you’ve learned with practice.</p>
        </div>
      </div>
      <nav className="crt-subject-grid" aria-label="Choose a CRT subject">
        <Link className="crt-practice-card" to="/crt?subject=practice">
          <CrtPracticeArt />
          <div className="crt-practice-card-copy">
            <span className="crt-eyebrow">MAKE IT SECOND NATURE</span>
            <h3>Practice</h3>
            <p>
              Pick a subject, choose your topics and build a question set just
              for you.
            </p>
          </div>
          <span className="crt-practice-card-action">
            Start practising <span aria-hidden="true">→</span>
          </span>
        </Link>
        {crtSubjects.map((subject, index) => {
          const assigned = topics.filter(
            (topic) => topic.subjectId === subject.id,
          );
          const completed = assigned.filter((topic) => topic.completed).length;
          const percent = assigned.length
            ? (completed / assigned.length) * 100
            : 0;
          return (
            <Link
              className={`crt-subject-card crt-subject-card--${subject.id}`}
              to={`/crt?subject=${subject.id}`}
              key={subject.id}
              aria-label={`${subject.name}, ${assigned.length} topics, ${completed} completed`}
            >
              <div className="crt-subject-card-top">
                <span className="crt-subject-number" aria-hidden="true">
                  0{index + 1}
                </span>
                <span className="crt-subject-tagline" aria-hidden="true">
                  {subjectTaglines[subject.id]}
                </span>
                <CrtSubjectArt subject={subject.id} />
              </div>
              <div className="crt-subject-card-body">
                <h3>{subject.name}</h3>
                <p>{subjectDescriptions[subject.id]}</p>
                <div className="crt-subject-card-progress">
                  <span>
                    {assigned.length}{" "}
                    {assigned.length === 1 ? "topic" : "topics"}
                  </span>
                  <span>
                    {assigned.length
                      ? `${completed} completed`
                      : "Awaiting topics"}
                  </span>
                  <div
                    className="crt-subject-progress-track"
                    aria-hidden="true"
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
                <span className="crt-subject-card-action">
                  Explore topics <span aria-hidden="true">→</span>
                </span>
              </div>
            </Link>
          );
        })}
      </nav>
    </section>
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
  const [show, setShow] = useState("all");
  const searchId = useId();
  const headingId = useId();
  const filtered = topics.filter(
    (topic) =>
      `${topic.title} ${topic.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()) &&
      (show === "all" ||
        (show === "completed" ? topic.completed : !topic.completed)),
  );
  const completed = topics.filter((topic) => topic.completed).length;
  const percent = topics.length
    ? Math.round((completed / topics.length) * 100)
    : 0;
  const positions = new Map(
    topics.map((topic, index) => [topic.id, index + 1]),
  );
  return (
    <section
      className={`crt-library crt-library--${subject}`}
      aria-labelledby={headingId}
    >
      <header className="crt-library-hero">
        <div className="crt-library-intro">
          <span className="crt-eyebrow">LEARN A LITTLE. BUILD CONFIDENCE.</span>
          <h1 id={headingId}>
            {crtSubjects.find((item) => item.id === subject)?.name}
          </h1>
          <p>{subjectDescriptions[subject]}</p>
        </div>
        <div className="crt-library-visual" aria-hidden="true">
          <CrtSubjectArt subject={subject} />
        </div>
        <div className="crt-library-progress">
          <div className="crt-progress-ring" aria-hidden="true">
            <svg viewBox="0 0 80 80">
              <circle
                className="crt-progress-ring-track"
                cx="40"
                cy="40"
                r="33"
              />
              <circle
                className="crt-progress-ring-fill"
                cx="40"
                cy="40"
                r="33"
                pathLength="100"
                strokeDasharray={`${percent} 100`}
              />
            </svg>
            <strong>{percent}%</strong>
          </div>
          <div>
            <span>Your progress</span>
            <strong>
              {completed} of {topics.length} complete
            </strong>
            <small>
              {topics.length === 0
                ? "New topics coming soon"
                : completed === topics.length
                  ? "Every topic completed. Well done!"
                  : `${topics.length - completed} topics to explore`}
            </small>
          </div>
        </div>
      </header>
      {topics.length > 0 ? (
        <>
          <div className="crt-library-tools">
            <label className="crt-search" htmlFor={searchId}>
              <span className="crt-visually-hidden">Find a topic</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                id={searchId}
                type="search"
                placeholder="Search your topics…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div
              className="crt-progress-filters"
              role="group"
              aria-label="Filter topics by progress"
            >
              {[
                { value: "all", label: "All topics", count: topics.length },
                {
                  value: "remaining",
                  label: "To complete",
                  count: topics.length - completed,
                },
                { value: "completed", label: "Completed", count: completed },
              ].map((filter) => (
                <button
                  type="button"
                  key={filter.value}
                  aria-pressed={show === filter.value}
                  onClick={() => setShow(filter.value)}
                >
                  {filter.label} <span>{filter.count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="crt-library-results">
            <h2>
              Your topics{" "}
              <span aria-live="polite" aria-atomic="true">
                {filtered.length} {filtered.length === 1 ? "topic" : "topics"}
              </span>
            </h2>
            {search || show !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setShow("all");
                }}
              >
                Clear filters
              </button>
            ) : (
              <span>Read. Practise. Make progress.</span>
            )}
          </div>
          {filtered.length ? (
            <div className="crt-topic-grid">
              {filtered.map((topic) => (
                <button
                  type="button"
                  className={`crt-topic-link${topic.completed ? " is-complete" : ""}`}
                  key={topic.id}
                  onClick={() => onOpen(topic)}
                  aria-label={`${topic.title}${topic.completed ? ", completed" : ""}`}
                >
                  <span className="crt-topic-heading">
                    <span className="crt-topic-index">
                      {String(positions.get(topic.id)).padStart(2, "0")}
                    </span>
                    <strong className="crt-topic-title">{topic.title}</strong>
                  </span>
                  <span className="crt-topic-meta">
                    <span>
                      <StudentIcon name="courses" /> Study notes
                    </span>
                    <span>
                      {topic.questionCount}{" "}
                      {topic.questionCount === 1 ? "question" : "questions"}
                    </span>
                    <span>
                      {topic.completed
                        ? topic.bestScore !== null
                          ? `Best score ${topic.bestScore}%`
                          : "Completed"
                        : `Pass ${topic.passingScore}%`}
                    </span>
                  </span>
                  <span className="crt-topic-card-footer">
                    <span className="crt-topic-action">
                      {topic.completed ? "Review topic" : "Start learning"}
                      <span className="crt-topic-arrow" aria-hidden="true">
                        →
                      </span>
                    </span>
                    <span className="crt-topic-status">
                      {topic.completed && <StudentIcon name="check" />}
                      {topic.completed
                        ? "Completed"
                        : topic.bestScore !== null
                          ? "Keep going"
                          : "Ready to start"}
                    </span>
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
    <section className="crt-reader">
      <nav className="crt-reader-navigation" aria-label="CRT navigation">
        <Link className="crt-back crt-home-link" to="/crt">
          <span aria-hidden="true">←</span> All CRT subjects
        </Link>
        <span aria-hidden="true" className="crt-reader-nav-divider">
          /
        </span>
        <button type="button" className="crt-back" onClick={onBack}>
          ← All topics
        </button>
      </nav>
      <Status
        pending={detail.isPending}
        error={detail.error}
        label="Opening your topic"
      />
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
  const [activePanel, setActivePanel] = useState<"lesson" | "assessment">(
    "lesson",
  );
  const activityId = useId();
  const lessonTab = useRef<HTMLButtonElement>(null);
  const assessmentTab = useRef<HTMLButtonElement>(null);
  const selectPanel = (
    panel: "lesson" | "assessment",
    focus = false,
    scroll = false,
  ) => {
    setActivePanel(panel);
    const tab = (panel === "lesson" ? lessonTab : assessmentTab).current;
    if (focus) tab?.focus({ preventScroll: !scroll });
    if (scroll) tab?.scrollIntoView?.({ block: "start", behavior: "auto" });
  };
  const answeredCount = topic.questions.filter(
    (question) =>
      Number.isInteger(answers[question.id]) &&
      answers[question.id] >= 0 &&
      answers[question.id] < question.options.length,
  ).length;
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
          <div className="crt-reader-title">
            <h1>{topic.title}</h1>
            <span className="crt-eyebrow">
              {
                crtSubjects.find((subject) => subject.id === topic.subjectId)
                  ?.name
              }
            </span>
          </div>
          {topic.description && <p>{topic.description}</p>}
        </div>
        {topic.completed && (
          <span className="crt-completed-badge">
            <StudentIcon name="check" />
            Completed
          </span>
        )}
      </div>
      <div className="crt-topic-workspace">
        <div
          className="crt-activity-tabs"
          role="tablist"
          aria-label="Topic activity"
          onKeyDown={(event) => {
            const panels = ["lesson", "assessment"] as const;
            let next: "lesson" | "assessment";
            if (event.key === "ArrowRight" || event.key === "ArrowLeft")
              next = panels[activePanel === "lesson" ? 1 : 0];
            else if (event.key === "Home") next = "lesson";
            else if (event.key === "End") next = "assessment";
            else return;
            event.preventDefault();
            selectPanel(next, true);
          }}
        >
          <button
            ref={lessonTab}
            type="button"
            role="tab"
            id={`${activityId}-lesson-tab`}
            aria-label="PDF lesson"
            aria-selected={activePanel === "lesson"}
            aria-controls={`${activityId}-lesson-panel`}
            tabIndex={activePanel === "lesson" ? 0 : -1}
            onClick={() => selectPanel("lesson")}
          >
            <StudentIcon name="courses" />
            <span>PDF lesson</span>
            <small>Read & learn</small>
          </button>
          <button
            ref={assessmentTab}
            type="button"
            role="tab"
            id={`${activityId}-assessment-tab`}
            aria-label="Assessment"
            aria-selected={activePanel === "assessment"}
            aria-controls={`${activityId}-assessment-panel`}
            tabIndex={activePanel === "assessment" ? 0 : -1}
            onClick={() => selectPanel("assessment")}
          >
            <StudentIcon name="practice" />
            <span>Assessment</span>
            <small aria-hidden="true">
              {submit.data
                ? "View results"
                : `${answeredCount}/${topic.questions.length} answered`}
            </small>
          </button>
        </div>
        <div
          className="crt-activity-panel"
          role="tabpanel"
          id={`${activityId}-lesson-panel`}
          aria-labelledby={`${activityId}-lesson-tab`}
          hidden={activePanel !== "lesson"}
          tabIndex={0}
        >
          <PdfReader topic={topic} />
          <div className="crt-reading-next">
            <p>
              Ready to put this into practice? You can return to the PDF
              anytime.
            </p>
            <button
              type="button"
              className="a-btn pri"
              onClick={() => selectPanel("assessment", true, true)}
            >
              {submit.data
                ? "View assessment results"
                : "Continue to assessment"}{" "}
              →
            </button>
          </div>
        </div>
        <div
          className="crt-activity-panel"
          role="tabpanel"
          id={`${activityId}-assessment-panel`}
          aria-labelledby={`${activityId}-assessment-tab`}
          hidden={activePanel !== "assessment"}
          tabIndex={0}
        >
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
                    {submit.isPending
                      ? "Checking answers…"
                      : "Submit assessment"}
                  </button>
                  <small>
                    {answeredCount} of {topic.questions.length} answered · Your
                    draft answers stay on this device.
                  </small>
                </div>
              </form>
            )}
          </section>
        </div>
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
        <h3>Read the lesson</h3>
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
        <Status
          pending={pdf.isPending}
          error={pdf.error}
          label="Preparing your study material"
        />
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
