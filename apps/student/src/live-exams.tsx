import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ExamAnswer,
  ExamAttemptView,
  ExamLanguage,
  StudentExamDetail,
  StudentExamSummary,
} from "@slate/contracts";
import { api, LessonContent, Select } from "@slate/ui";
import { Heading, NoResults, Status } from "./design";
import { useStudentData } from "./access";
import { ExamEventBuffer, ExamSession } from "./live-exam-session";

const date = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const minutes = (ms: number) =>
  `${Math.floor(ms / 60_000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, "0")}`;
const monitoringText =
  "This exam records when this tab is hidden, the window loses focus, or fullscreen is exited. No camera, microphone or screen recording is used. Browser events are review flags, not proof of misconduct.";
function Monitoring({ exam }: { exam: StudentExamDetail }) {
  return (
    <section className="exam-monitoring">
      <h2>Browser monitoring</h2>
      <p>
        {exam.monitoring.enabled
          ? monitoringText
          : "Browser monitoring is disabled for this exam."}
      </p>
      {exam.monitoring.enabled && exam.monitoring.recordClipboard && (
        <p>
          Copy, cut and paste event counts are recorded. Clipboard contents are
          never collected.
        </p>
      )}
      {exam.monitoring.enabled && exam.monitoring.requireFullscreen && (
        <p>
          Start in fullscreen and keep this exam open. If you leave fullscreen,
          use the return button; the timer continues.
        </p>
      )}
    </section>
  );
}
export function LiveExamsPage() {
  const data = useStudentData<StudentExamSummary[]>("exams", "student/exams");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const timer = setInterval(() => void data.refetch(), 30_000);
    return () => clearInterval(timer);
  }, [data.refetch]);
  const exams =
    data.data?.filter(
      (exam) =>
        filter === "all" ||
        (filter === "results"
          ? exam.resultsReleased && exam.attemptId
          : exam.state === filter),
    ) || [];
  return (
    <div className="a-page real-exams">
      <Heading title="Live exams">
        <button
          className="a-btn"
          disabled={data.isFetching}
          onClick={() => void data.refetch()}
        >
          Refresh
        </button>
      </Heading>
      <div className="exam-list-intro">
        <span className="hub-eyebrow">YOUR ASSESSMENTS</span>
        <h2>Ready for your next challenge?</h2>
        <p>
          Exams assigned by your organization, with schedules, saved attempts
          and released results.
        </p>
      </div>
      <div className="a-filters" aria-label="Exam status">
        {["all", "live", "upcoming", "ended", "cancelled", "results"].map(
          (value) => (
            <button
              key={value}
              className={`a-pill${filter === value ? " on" : ""}`}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ),
        )}
      </div>
      <Status pending={data.isPending} error={data.error} />
      {data.data &&
        (exams.length ? (
          <div className="hub-grid">
            {exams.map((exam) => (
              <article className="hub-card" key={exam.id}>
                <div className="hub-card-top">
                  <span
                    className={exam.state === "live" ? "live-status" : "a-tag"}
                  >
                    {exam.state === "live" ? "Live now" : exam.state}
                  </span>
                  {exam.attemptStatus && (
                    <span className="a-tag">
                      {exam.attemptStatus.replaceAll("_", " ")}
                    </span>
                  )}
                </div>
                <h2>{exam.title}</h2>
                <p>{exam.description}</p>
                <dl className="live-exam-facts">
                  <div>
                    <dt>Opens</dt>
                    <dd>{date(exam.startsAt)}</dd>
                  </div>
                  <div>
                    <dt>Closes</dt>
                    <dd>{date(exam.endsAt)}</dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{exam.durationMinutes} min</dd>
                  </div>
                  <div>
                    <dt>Assessment</dt>
                    <dd>
                      {exam.questionCount} questions · {exam.totalPoints} points
                    </dd>
                  </div>
                </dl>
                {exam.resultsReleased && exam.percentage !== null && (
                  <p className="live-result">
                    Result: <strong>{exam.percentage}%</strong>
                  </p>
                )}
                <Link className="a-btn pri" to={`/live-exams/${exam.id}`}>
                  {exam.attemptStatus === "in_progress"
                    ? "Resume exam"
                    : exam.resultsReleased && exam.attemptId
                      ? "View results"
                      : "View exam"}{" "}
                  →
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <NoResults
            title={
              filter === "all" ? "No exams assigned yet" : `No ${filter} exams`
            }
          >
            Your organization’s published exams will appear here. Check back
            when an exam is announced.
          </NoResults>
        ))}
    </div>
  );
}
export function LiveExamDetailPage() {
  const { id } = useParams();
  const data = useStudentData<StudentExamDetail>(
    `exam:${id}`,
    `student/exams/${id}`,
  );
  return (
    <div className="a-page real-exams">
      <Link className="exam-back" to="/live-exams">
        ← All exams
      </Link>
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <ExamInstructions
          key={data.data.id}
          exam={data.data}
          refresh={() => void data.refetch()}
        />
      )}
    </div>
  );
}
function ExamInstructions({
  exam,
  refresh,
}: {
  exam: StudentExamDetail;
  refresh: () => void;
}) {
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const finished = exam.attemptId && exam.attemptStatus !== "in_progress";
  async function start() {
    if (busy || !agreed) return;
    setBusy(true);
    setError("");
    try {
      if (
        exam.monitoring.enabled &&
        exam.monitoring.requireFullscreen &&
        !document.fullscreenElement
      ) {
        if (!document.documentElement.requestFullscreen)
          throw new Error(
            "This browser does not support fullscreen. Use a supported desktop browser to start this exam.",
          );
        await document.documentElement.requestFullscreen();
      }
      const attempt = await api<ExamAttemptView>(
        `student/exams/${exam.id}/attempt`,
        "POST",
        {},
      );
      navigate(`/live-exams/${exam.id}/attempt/${attempt.id}`);
    } catch (problem) {
      setError(
        (problem as Error).message ||
          "Could not start the exam. Refresh and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={exam.title}>
        <span className="a-tag">{exam.state}</span>
      </Heading>
      <p>{exam.description}</p>
      <div className="exam-detail-layout">
        <section className="exam-instructions">
          <h2>Before you begin</h2>
          <LessonContent
            body={
              exam.instructions ||
              "Read every question carefully and submit before the deadline."
            }
            format="markdown"
          />
          <Monitoring exam={exam} />
          <p className="hub-note">
            Multiple-choice answers are graded automatically. Your submitted
            code is reviewed by your administrator. Results appear after your
            administrator releases them.
          </p>
          <label className="exam-agree">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />{" "}
            I have read the instructions and monitoring information.
          </label>
          {error && (
            <p className="exam-alert" role="alert">
              {error}
            </p>
          )}
          {finished ? (
            <Link
              className="a-btn pri"
              to={`/live-exams/${exam.id}/attempt/${exam.attemptId}`}
            >
              View submission{exam.resultsReleased ? " and results" : ""} →
            </Link>
          ) : exam.state === "live" ? (
            <button
              className="a-btn pri"
              disabled={!agreed || busy}
              onClick={() => void start()}
            >
              {busy
                ? "Opening exam…"
                : exam.attemptId
                  ? "Resume exam"
                  : "Start exam"}
            </button>
          ) : (
            <p className="hub-note">
              {exam.state === "upcoming"
                ? "This exam is not open yet."
                : exam.state === "cancelled"
                  ? "Your administrator cancelled this exam."
                  : "The exam window has closed."}
            </p>
          )}
          <button className="a-btn" onClick={refresh} disabled={busy}>
            Refresh status
          </button>
        </section>
        <aside className="exam-summary">
          <h2>Exam details</h2>
          <dl>
            <dt>Opens</dt>
            <dd>{date(exam.startsAt)}</dd>
            <dt>Closes</dt>
            <dd>{date(exam.endsAt)}</dd>
            <dt>Your time</dt>
            <dd>{exam.durationMinutes} minutes</dd>
            <dt>Questions</dt>
            <dd>{exam.questionCount}</dd>
            <dt>Total points</dt>
            <dd>{exam.totalPoints}</dd>
            <dt>Passing score</dt>
            <dd>{exam.passingPercentage}%</dd>
          </dl>
          <p>
            Your deadline is the earlier of your time limit and the exam closing
            time. Reloading or leaving the page does not pause it. Answers save
            automatically while connected.
          </p>
        </aside>
      </div>
    </>
  );
}
export function LiveExamAttemptPage() {
  const { id, attemptId } = useParams();
  const data = useStudentData<ExamAttemptView>(
    `exam-attempt:${attemptId}`,
    `student/exam-attempts/${attemptId}`,
  );
  return (
    <div className="a-page real-exams">
      <Status pending={data.isPending && !data.data} error={data.error} />
      {data.data && data.data.examId === id && (
        <ExamAttempt key={data.data.id} initial={data.data} />
      )}
      {data.data && data.data.examId !== id && (
        <p role="alert">
          This attempt belongs to another exam. Return to your exam list.
        </p>
      )}
    </div>
  );
}
export function ExamAttempt({ initial }: { initial: ExamAttemptView }) {
  const [session] = useState(() => new ExamSession(initial, api));
  const state = useSyncExternalStore(session.subscribe, session.snapshot);
  const { view, answers } = state;
  const [remaining, setRemaining] = useState(session.remaining()),
    [active, setActive] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [confirm, setConfirm] = useState<"submit" | "reload" | null>(null),
    [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement)),
    [fullscreenError, setFullscreenError] = useState("");
  const expiredOnce = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const monitor = useRef<ExamEventBuffer | null>(null);
  const query = useQueryClient();
  const finished = view.status !== "in_progress";
  const expired = remaining <= 0;
  const editable =
    !finished &&
    !expired &&
    !state.conflict &&
    !state.submitting &&
    !state.reloading;
  const question = view.questions[active];
  const answer = answers.find((item) => item.questionId === question?.id);
  const answered = (item: ExamAnswer | undefined) =>
    typeof item?.selectedOption === "number" || Boolean(item?.code?.trim());
  const answerCount = view.questions.filter((item) =>
    answered(answers.find((value) => value.questionId === item.id)),
  ).length;
  useEffect(() => {
    const tick = () => setRemaining(session.remaining());
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (!state.dirty || !editable || state.error || !online) return;
    const timer = setTimeout(() => void session.save(), 600);
    return () => clearTimeout(timer);
  }, [answers, state.dirty, state.error, editable, online, session]);
  useEffect(() => {
    if (expired && !finished && !expiredOnce.current) {
      expiredOnce.current = true;
      void monitor.current?.flush();
      void session.submit(true);
    }
  }, [expired, finished, session]);
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    const before = (event: BeforeUnloadEvent) => {
      if (!finished) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("online", changed);
    window.addEventListener("offline", changed);
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("online", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("beforeunload", before);
    };
  }, [finished]);
  useEffect(() => {
    if (online && state.dirty && !state.conflict && !expired)
      void session.save();
  }, [online]);
  useEffect(() => {
    if (finished) {
      void query.invalidateQueries({
        predicate: (item) =>
          item.queryKey[0] === "student" && item.queryKey[1] === "exams",
      });
      if (view.status === "graded") return;
      const timer = setInterval(() => void session.reload(), 30_000);
      return () => clearInterval(timer);
    }
  }, [finished, view.status, session, query]);
  useEffect(() => {
    const events = new ExamEventBuffer(
      (batch) =>
        api(`student/exam-attempts/${view.id}/events`, "POST", {
          events: batch,
        }),
      session.now,
    );
    monitor.current = events;
    const add = (type: Parameters<typeof events.add>[0]) => {
      if (view.exam.monitoring.enabled && !finished && session.remaining() > 0)
        events.add(type);
    };
    const visibility = () => {
      if (document.hidden) {
        add("tab_hidden");
        void events.flush();
      }
    };
    const blur = () => add("window_blur");
    let wasFullscreen = Boolean(document.fullscreenElement);
    const full = () => {
      const next = Boolean(document.fullscreenElement);
      setFullscreen(next);
      if (wasFullscreen && !next) add("fullscreen_exit");
      wasFullscreen = next;
    };
    const clipboard = (event: Event) => {
      if (view.exam.monitoring.recordClipboard)
        add(event.type as "copy" | "paste" | "cut");
    };
    const connectivity = (event: Event) =>
      add(event.type as "online" | "offline");
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", blur);
    document.addEventListener("fullscreenchange", full);
    for (const event of ["copy", "paste", "cut"])
      document.addEventListener(event, clipboard);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    const timer = setInterval(() => void events.flush(), 10_000);
    return () => {
      clearInterval(timer);
      void events.flush();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      document.removeEventListener("fullscreenchange", full);
      for (const event of ["copy", "paste", "cut"])
        document.removeEventListener(event, clipboard);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, [
    view.id,
    view.exam.monitoring.enabled,
    view.exam.monitoring.recordClipboard,
    finished,
    session,
  ]);
  useEffect(() => {
    if (!confirm) return;
    const prior = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirm(null);
      }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      prior?.focus();
    };
  }, [confirm]);
  useEffect(() => {
    if (finished || !state.dirty) return;
    const leave = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        !link ||
        link.target === "_blank" ||
        link.download ||
        link.href === window.location.href
      )
        return;
      const target = new URL(link.href);
      if (
        target.origin === window.location.origin &&
        target.pathname === window.location.pathname &&
        target.search === window.location.search
      )
        return;
      if (
        !window.confirm(
          "Your latest answers have not been saved. Leave this exam and discard unsaved changes? The timer will continue.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const initialIndex = window.history.state?.idx;
    let restoring = false;
    const historyNavigation = (event: PopStateEvent) => {
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        return;
      }
      const nextIndex = window.history.state?.idx;
      if (
        typeof initialIndex !== "number" ||
        typeof nextIndex !== "number" ||
        initialIndex === nextIndex
      )
        return;
      if (
        !window.confirm(
          "Your latest answers have not been saved. Leave this exam and discard unsaved changes? The timer will continue.",
        )
      ) {
        // Capture runs before BrowserRouter's history listener, so cancellation keeps this attempt mounted.
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(initialIndex - nextIndex);
      }
    };
    const directNavigation = (event: Event) => {
      if (
        !window.confirm(
          "Your latest answers have not been saved. Leave this exam and discard unsaved changes? The timer will continue.",
        )
      )
        event.preventDefault();
    };
    document.addEventListener("click", leave, true);
    window.addEventListener("popstate", historyNavigation, true);
    window.addEventListener("student-before-navigation", directNavigation);
    return () => {
      document.removeEventListener("click", leave, true);
      window.removeEventListener("popstate", historyNavigation, true);
      window.removeEventListener("student-before-navigation", directNavigation);
    };
  }, [finished, state.dirty]);
  if (finished)
    return (
      <ExamSubmitted
        view={view}
        refresh={() => void session.reload()}
        error={state.error}
      />
    );
  return (
    <>
      <div className="exam-session-header">
        <div>
          <span className="hub-eyebrow">LIVE EXAM</span>
          <h1>{view.exam.title}</h1>
          <p>
            {answerCount} / {view.questions.length} answered ·{" "}
            <span role="status">
              {state.reloading
                ? "Loading saved answers…"
                : state.submitting
                  ? "Submitting…"
                  : state.saving
                    ? "Saving…"
                    : state.dirty
                      ? "Unsaved changes"
                      : "All answers saved"}
            </span>
          </p>
        </div>
        <div
          className={`exam-timer${remaining < 300_000 ? " urgent" : ""}`}
          role="timer"
          aria-label={`${minutes(remaining)} remaining`}
        >
          <small>Time remaining</small>
          <strong>{minutes(remaining)}</strong>
          <span>Deadline {date(view.deadlineAt)}</span>
        </div>
        <button
          className="a-btn pri"
          disabled={!editable}
          onClick={() => {
            void monitor.current?.flush();
            setConfirm("submit");
          }}
        >
          Submit exam
        </button>
      </div>
      {!online && (
        <p className="exam-alert" role="alert">
          You’re offline. The timer continues. Latest changes are only in this
          tab until saved; reconnect before the deadline.
        </p>
      )}
      {state.error && (
        <div className="exam-alert" role="alert">
          <p>{state.error}</p>
          {state.conflict ? (
            <button
              className="a-btn"
              disabled={state.saving || state.reloading}
              onClick={() => setConfirm("reload")}
            >
              Reload saved attempt
            </button>
          ) : (
            <button
              className="a-btn"
              disabled={state.saving || state.submitting || state.reloading}
              onClick={() =>
                void (expired ? session.submit(true) : session.save())
              }
            >
              {expired ? "Retry submission" : "Retry saving"}
            </button>
          )}
        </div>
      )}
      {expired && (
        <p className="exam-alert" role="status">
          Time is up. Editing is closed. The server will submit the answers
          saved before your deadline.
          {state.dirty &&
            " Unsaved changes made after the last successful save cannot be included."}
        </p>
      )}
      {view.exam.monitoring.enabled &&
        view.exam.monitoring.requireFullscreen &&
        !fullscreen &&
        !expired && (
          <div className="exam-monitor-bar">
            Fullscreen is required. Your timer is still running.{" "}
            <button
              className="a-btn"
              onClick={() => {
                void document.documentElement
                  .requestFullscreen?.()
                  .catch(() =>
                    setFullscreenError(
                      "Could not enter fullscreen. Check your browser permissions.",
                    ),
                  );
              }}
            >
              Return to fullscreen
            </button>
          </div>
        )}
      {fullscreenError && (
        <p className="exam-alert" role="alert">
          {fullscreenError}
        </p>
      )}
      <div className="exam-session-layout">
        <aside className="exam-question-nav" aria-label="Question navigator">
          <h2>Questions</h2>
          <div>
            {view.questions.map((item, index) => (
              <button
                key={item.id}
                className={`${active === index ? "active " : ""}${answered(answers.find((value) => value.questionId === item.id)) ? "answered" : ""}`}
                aria-current={active === index ? "step" : undefined}
                aria-label={`Question ${index + 1}: ${answered(answers.find((value) => value.questionId === item.id)) ? "answered" : "unanswered"}`}
                onClick={() => setActive(index)}
              >
                {index + 1}
              </button>
            ))}
          </div>
          <p>
            Filled: answered
            <br />
            Outlined: current question
          </p>
          <small>
            {view.exam.monitoring.enabled
              ? "Browser events are recorded for review. No camera or screen recording."
              : "Browser monitoring is off."}
          </small>
        </aside>
        {question && (
          <section
            className={`exam-question ${question.kind === "coding" ? "is-coding" : ""}`}
          >
            <div className="exam-question-prompt">
              <span className="a-tag">
                Question {active + 1} · {question.points} points ·{" "}
                {question.kind === "mcq" ? "Multiple choice" : "Coding"}
              </span>
              <h2>{question.title}</h2>
              <LessonContent body={question.prompt} format="markdown" />
              {question.kind === "coding" &&
                question.testCases.some((item) => !item.hidden) && (
                  <div className="exam-public-cases">
                    <h3>Example input and output</h3>
                    {question.testCases
                      .filter((item) => !item.hidden)
                      .map((item, index) => (
                        <div key={item.id}>
                          <b>Example {index + 1}</b>
                          <pre>
                            Input: {item.input}
                            {"\n"}Output: {item.output}
                          </pre>
                        </div>
                      ))}
                    <p>
                      Use these examples to understand the expected input and
                      output. Your administrator reviews your submitted code.
                    </p>
                  </div>
                )}
            </div>
            {question.kind === "mcq" ? (
              <fieldset className="exam-mcq" disabled={!editable}>
                <legend className="student-skip">
                  Choose one answer for {question.title}
                </legend>
                {question.options.map((option, index) => (
                  <label
                    key={index}
                    className={
                      answer?.selectedOption === index ? "selected" : ""
                    }
                  >
                    <input
                      type="radio"
                      name={`question-${question.id}`}
                      checked={answer?.selectedOption === index}
                      onChange={() =>
                        session.edit({
                          questionId: question.id,
                          selectedOption: index,
                        })
                      }
                    />
                    <span>{String.fromCharCode(65 + index)}.</span>
                    {option}
                  </label>
                ))}
                <button
                  className="a-btn"
                  disabled={answer?.selectedOption == null}
                  onClick={() =>
                    session.edit({
                      questionId: question.id,
                      selectedOption: null,
                    })
                  }
                >
                  Clear answer
                </button>
              </fieldset>
            ) : (
              <div className="exam-code-pane">
                <div className="exam-code-toolbar">
                  <label htmlFor="exam-language">Language</label>
                  <Select
                    id="exam-language"
                    aria-label="Programming language"
                    value={answer?.language || question.languages[0]}
                    options={question.languages.map((language) => ({
                      value: language,
                      label: language,
                    }))}
                    disabled={!editable}
                    onChange={(language) => {
                      const prior = answer?.language || question.languages[0];
                      const oldCode =
                        answer?.code ?? question.starterCode[prior] ?? "";
                      session.edit({
                        questionId: question.id,
                        language: language as ExamLanguage,
                        code:
                          oldCode === (question.starterCode[prior] ?? "")
                            ? (question.starterCode[language as ExamLanguage] ??
                              "")
                            : oldCode,
                      });
                    }}
                  />
                </div>
                <label className="student-skip" htmlFor="exam-source">
                  Code for {question.title}
                </label>
                <textarea
                  id="exam-source"
                  className="exam-code-editor"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  maxLength={30000}
                  readOnly={!editable}
                  value={
                    answer?.code ??
                    question.starterCode[
                      answer?.language || question.languages[0]
                    ] ??
                    ""
                  }
                  onChange={(event) =>
                    session.edit({
                      questionId: question.id,
                      language: answer?.language || question.languages[0],
                      code: event.target.value,
                    })
                  }
                />
                <p className="exam-source-limit">
                  Maximum 30,000 characters. Your administrator reviews your
                  submitted code.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
      <div className="exam-bottom-nav">
        <button
          className="a-btn"
          disabled={active === 0}
          onClick={() => setActive((value) => value - 1)}
        >
          ← Previous
        </button>
        <button
          className="a-btn"
          disabled={active === view.questions.length - 1}
          onClick={() => setActive((value) => value + 1)}
        >
          Next →
        </button>
      </div>
      {confirm && (
        <div className="exam-dialog-backdrop">
          <section
            ref={dialogRef}
            className="exam-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-confirm-title"
          >
            <h2 id="exam-confirm-title">
              {confirm === "submit"
                ? "Submit your exam?"
                : "Reload saved answers?"}
            </h2>
            <p>
              {confirm === "submit"
                ? `You answered ${answerCount} of ${view.questions.length} questions. Your latest answers will be submitted together. You cannot edit after submitting.`
                : "This replaces unsaved changes in this tab with the latest answers stored on the server."}
            </p>
            <div>
              <button
                className="a-btn"
                autoFocus
                onClick={() => setConfirm(null)}
              >
                Keep reviewing
              </button>
              <button
                className="a-btn pri"
                onClick={() => {
                  const action = confirm;
                  setConfirm(null);
                  void (action === "submit"
                    ? session.submit()
                    : session.reload());
                }}
              >
                {confirm === "submit" ? "Submit answers" : "Reload from server"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function ExamSubmitted({
  view,
  refresh,
  error,
}: {
  view: ExamAttemptView;
  refresh: () => void;
  error: string;
}) {
  const result = view.exam.resultsReleased ? view.result : null;
  return (
    <>
      <Link className="exam-back" to="/live-exams">
        ← All exams
      </Link>
      <Heading title={view.exam.title}>
        <span className="a-tag">
          {view.status === "grading" ? "Grading" : "Submitted"}
        </span>
      </Heading>
      <section className="exam-submitted">
        <h2>{result ? "Your results" : "Your exam has been submitted"}</h2>
        <p>
          {view.submittedAt
            ? `Submitted ${date(view.submittedAt)}.`
            : "Your saved answers are being processed."}{" "}
          You can no longer edit this attempt.
        </p>
        {result ? (
          <>
            <div className="exam-score">
              <strong>
                {result.earnedPoints ?? "Pending"} / {result.totalPoints}
              </strong>
              <span>
                {result.percentage !== null
                  ? `${result.percentage}%`
                  : "Grading in progress"}
                {result.passed !== null
                  ? ` · ${result.passed ? "Passed" : "Not passed"}`
                  : ""}
              </span>
            </div>
            <div className="exam-results-list">
              {result.questions.map((item) => (
                <details key={item.questionId}>
                  <summary>
                    {item.title}{" "}
                    <span>
                      {item.earnedPoints ?? "Pending"} / {item.points} ·{" "}
                      {item.verdict}
                    </span>
                  </summary>
                  {item.totalTests !== undefined && (
                    <p>
                      {item.passedTests ?? 0} of {item.totalTests} tests passed
                    </p>
                  )}
                  {item.correctOption !== undefined && (
                    <p>
                      Correct answer:{" "}
                      {String.fromCharCode(65 + item.correctOption)}
                    </p>
                  )}
                  {item.explanation && (
                    <LessonContent body={item.explanation} format="markdown" />
                  )}
                </details>
              ))}
            </div>
          </>
        ) : (
          <p className="exam-monitoring">
            {view.exam.resultsReleased
              ? "Grading is in progress. Refresh shortly for results."
              : "Results will appear after your administrator releases them."}
          </p>
        )}
        {error && (
          <p role="alert" className="exam-alert">
            {error}
          </p>
        )}
        <button className="a-btn" onClick={refresh}>
          Refresh results
        </button>
      </section>
    </>
  );
}
