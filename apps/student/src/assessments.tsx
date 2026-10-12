import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PracticeAssessment } from "@slate/contracts";
import { useMe } from "@slate/ui";
import { Banner, Heading, NoResults, Status } from "./design";
import { CodingWorkspace } from "./coding";
import {
  AccessUnavailable,
  hasCodingAccess,
  useStudentData as useData,
} from "./access";
import { savePracticeResult } from "./practice-history";

const labels = {
  aptitude: "Aptitude & reasoning",
  coding: "Coding",
  web: "Web development",
  skills: "Skills & interviews",
};
export function PracticeCatalogue() {
  const data = useData<PracticeAssessment[]>("practice", "student/practice"),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const items =
    data.data?.filter(
      (item) =>
        item.kind !== "coding" &&
        (filter === "all" || item.category === filter) &&
        `${item.title} ${item.description}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) || [];
  const coding = data.data?.filter((item) => item.kind === "coding") || [];
  const showCoding =
    coding.length > 0 &&
    (filter === "all" || filter === "coding") &&
    (!search ||
      coding.some((item) =>
        `${item.title} ${item.topics?.join(" ")} DSA coding questions`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ));
  return (
    <div className="a-page">
      <Heading title="Practice">
        <span className="a-tag">At your own pace</span>
      </Heading>
      <Banner
        eyebrow="A LITTLE BETTER, EVERY DAY"
        title="Your practice starts here."
        description="Your assigned practice activities in one place. Choose a topic and give it a try."
        glyph="⌘"
      />
      <p className="hub-note">
        {data.data?.length
          ? "Sample learning activities selected by your organization. Practice results stay in this browser and are not official exam results."
          : "Practise as often as you like with activities assigned by your placement team."}
      </p>
      <div className="a-filters">
        {[
          ["all", "All practice"],
          ...Object.entries(labels).filter(([category]) =>
            data.data?.some((item) => item.category === category),
          ),
        ].map(([id, label]) => (
          <button
            key={id}
            className={`a-pill${filter === id ? " on" : ""}`}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <input
          className="a-search practice-search"
          type="search"
          aria-label="Search practice"
          placeholder="Search practice"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <Status pending={data.isPending} error={data.error} />
      {data.data && (
        <>
          <p className="hub-note" role="status">
            {items.length} practice activities
            {showCoding ? ` · ${coding.length} coding questions` : ""}
          </p>
          {items.length || showCoding ? (
            <div className="hub-grid">
              {showCoding && (
                <article className="hub-card coding-library-entry">
                  <div className="hub-card-top">
                    <span className="a-tag">Problem solving</span>
                    <span className="a-tag">Easy · Medium · Hard</span>
                  </div>
                  <h2>DSA / Coding Questions</h2>
                  <p>
                    Explore {coding.length} problems across 20 topics. Filter by
                    difficulty, build your practice lists and solve in a focused
                    coding workspace.
                  </p>
                  <small>
                    {coding.length} problems · 16 languages · Sample library
                  </small>
                  <div className="hub-actions">
                    <Link
                      className="a-btn pri"
                      to={`/practice/coding${search ? `?search=${encodeURIComponent(search)}` : ""}`}
                    >
                      Open problem library →
                    </Link>
                  </div>
                </article>
              )}
              {items.map((item) => (
                <article className="hub-card" key={item.id}>
                  <div className="hub-card-top">
                    <span className="a-tag">{labels[item.category]}</span>
                    <span className="a-tag">{item.difficulty}</span>
                  </div>
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                  <small>
                    {item.durationMinutes} min ·{" "}
                    {item.questions
                      ? `${item.questions.length} questions`
                      : item.kind === "coding"
                        ? "1 coding problem"
                        : item.kind === "typing"
                          ? "Speed & accuracy"
                          : "Guided activity"}{" "}
                    · Sample
                  </small>
                  <div className="hub-actions">
                    <Link className="a-btn pri" to={`/practice/${item.id}`}>
                      Start practice →
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <NoResults
              title={
                search || filter !== "all"
                  ? "No matching practice found"
                  : "No practice assessments yet"
              }
              action={
                <button
                  className="a-btn"
                  onClick={() => {
                    setFilter("all");
                    setSearch("");
                  }}
                >
                  Clear filters
                </button>
              }
            >
              {search || filter !== "all"
                ? "Try another topic or clear your filters."
                : "Assigned practice assessments will appear here when they become available."}
            </NoResults>
          )}
        </>
      )}
    </div>
  );
}
export function AssessmentPlayer() {
  const me = useMe();
  const { id } = useParams(),
    data = useData<PracticeAssessment[]>("practice", "student/practice");
  if (data.isPending || data.error)
    return (
      <div className="a-page">
        <Status pending={data.isPending} error={data.error} />
      </div>
    );
  const assessment = data.data?.find((item) => item.id === id);
  if (assessment?.kind === "coding" && !hasCodingAccess(me.data))
    return <AccessUnavailable />;
  return (
    <div className="a-page">
      {assessment?.kind !== "coding" && (
        <div className="a-crumbs">
          <Link to="/practice">Practice</Link>
          <span>›</span>
          <span>{assessment?.title || "Activity"}</span>
        </div>
      )}
      <Status pending={data.isPending} error={data.error} />
      {assessment?.kind === "coding" ? (
        <CodingWorkspace
          key={assessment.id}
          assessment={assessment}
          items={(data.data || []).filter((item) => item.kind === "coding")}
        />
      ) : assessment ? (
        <Player key={assessment.id} assessment={assessment} />
      ) : (
        !data.isPending && (
          <NoResults title="Activity not available">
            Choose an activity assigned to your account.
          </NoResults>
        )
      )}
    </div>
  );
}
function Player({ assessment }: { assessment: PracticeAssessment }) {
  const me = useMe();
  const resultId = useRef(crypto.randomUUID());
  const recorded = useRef(false);
  const [historySaved, setHistorySaved] = useState<boolean | null>(null);
  const [started, setStarted] = useState(false),
    [finished, setFinished] = useState(false),
    [index, setIndex] = useState(0),
    [answers, setAnswers] = useState<Record<string, number>>({}),
    [remaining, setRemaining] = useState(assessment.durationMinutes * 60),
    [typed, setTyped] = useState(""),
    [notes, setNotes] = useState(""),
    [repository, setRepository] = useState(""),
    [message, setMessage] = useState("");
  const questions = assessment.questions || [],
    current = questions[index];
  useEffect(() => {
    if (!started || finished) return;
    const timer = window.setInterval(
      () => setRemaining((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [started, finished]);
  useEffect(() => {
    if (started && remaining === 0) setFinished(true);
  }, [started, remaining]);
  const correct = questions.filter(
    (question) => answers[question.id] === question.answer,
  ).length;
  const accuracy = typed.length
    ? Math.round(
        ([...typed].filter(
          (character, offset) => character === assessment.passage?.[offset],
        ).length /
          typed.length) *
          100,
      )
    : 0;
  const minutes = Math.max(1, assessment.durationMinutes * 60 - remaining) / 60;
  useEffect(() => {
    if (!finished || !questions.length || !me.data || recorded.current) return;
    recorded.current = true;
    setHistorySaved(
      savePracticeResult(me.data.id, {
        id: resultId.current,
        title: assessment.title,
        score: Math.round((correct / questions.length) * 100),
        completedAt: new Date().toISOString(),
      }),
    );
  }, [finished, questions.length, correct, assessment.title, me.data]);
  return (
    <>
      <Heading title={assessment.title}>
        <span className="a-tag">Sample practice</span>
        {started && !finished && (
          <span className="a-tag" role="timer">
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </span>
        )}
      </Heading>
      <p className="hub-note">
        Local preview · Quiz and typing results are calculated in this screen.
        Coding results are reference samples; no code is compiled. No official
        grades or project submissions are created.
      </p>
      {!started ? (
        <section className="hub-card demo-instructions">
          <h2>Before you begin</h2>
          <p>{assessment.description}</p>
          <dl className="live-exam-facts">
            <div>
              <dt>Suggested time</dt>
              <dd>{assessment.durationMinutes} minutes</dd>
            </div>
            <div>
              <dt>Difficulty</dt>
              <dd>{assessment.difficulty}</dd>
            </div>
            <div>
              <dt>Activity</dt>
              <dd>
                {questions.length
                  ? `${questions.length} questions`
                  : assessment.kind}
              </dd>
            </div>
            <div>
              <dt>Scoring</dt>
              <dd>
                {questions.length
                  ? "One point per correct answer · No negative marking"
                  : "Practice preview"}
              </dd>
            </div>
          </dl>
          <p>
            You can navigate between questions before finishing. The local timer
            begins when you start.
          </p>
          <div className="hub-actions">
            <button className="a-btn pri" onClick={() => setStarted(true)}>
              Start practice
            </button>
            <Link className="a-btn" to="/practice">
              Back to practice
            </Link>
          </div>
        </section>
      ) : questions.length ? (
        finished ? (
          <section className="hub-card">
            <h2>Practice complete</h2>
            <p className="demo-score">
              {Math.round((correct / questions.length) * 100)}%
            </p>
            <p>
              {correct} of {questions.length} correct ·{" "}
              {Object.keys(answers).length} answered
            </p>
            <p className="hub-note">
              Preview result only. Review the explanations below to choose your
              next topic.
            </p>
            {historySaved !== null && (
              <p className="hub-note" role="status">
                {historySaved
                  ? "Added to your dashboard self-assessment graph. Saved in this browser only."
                  : "Your browser could not save this result. You can still review your answers here."}
              </p>
            )}
            {questions.map((question) => (
              <details className="demo-review" key={question.id}>
                <summary>
                  {answers[question.id] === question.answer ? "✓" : "○"}{" "}
                  {question.prompt}
                </summary>
                <p>
                  Your answer:{" "}
                  {answers[question.id] === undefined
                    ? "Not answered"
                    : question.options[answers[question.id]]}
                </p>
                <p>
                  Correct answer: <b>{question.options[question.answer]}</b>
                </p>
                <p>{question.explanation}</p>
              </details>
            ))}
            <div className="hub-actions">
              <Link className="a-btn" to="/">
                View my progress →
              </Link>
              <Link className="a-btn pri" to="/practice">
                Explore more practice →
              </Link>
            </div>
          </section>
        ) : (
          <div className="demo-quiz-layout">
            <section className="hub-card">
              <p className="hub-eyebrow">
                QUESTION {index + 1} OF {questions.length}
              </p>
              <h2>{current.prompt}</h2>
              <fieldset className="demo-options">
                <legend>Choose one answer</legend>
                {current.options.map((option, optionIndex) => (
                  <label key={option}>
                    <input
                      type="radio"
                      name={current.id}
                      checked={answers[current.id] === optionIndex}
                      onChange={() =>
                        setAnswers((value) => ({
                          ...value,
                          [current.id]: optionIndex,
                        }))
                      }
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </fieldset>
              <div className="hub-actions">
                <button
                  className="a-btn"
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  Previous question
                </button>
                {index < questions.length - 1 && (
                  <button
                    className="a-btn pri"
                    onClick={() => setIndex(index + 1)}
                  >
                    Next question →
                  </button>
                )}
                <button className="a-btn" onClick={() => setFinished(true)}>
                  Finish practice
                </button>
              </div>
            </section>
            <aside className="hub-card">
              <h2>Your questions</h2>
              <p>
                {Object.keys(answers).length} of {questions.length} answered
              </p>
              <div className="demo-question-nav">
                {questions.map((question, questionIndex) => (
                  <button
                    key={question.id}
                    className={`a-btn${questionIndex === index ? " pri" : ""}`}
                    aria-label={`Go to question ${questionIndex + 1}${answers[question.id] !== undefined ? ", answered" : ""}`}
                    onClick={() => setIndex(questionIndex)}
                  >
                    {questionIndex + 1}
                    {answers[question.id] !== undefined ? " ✓" : ""}
                  </button>
                ))}
              </div>
              <small>You can revisit any answer before finishing.</small>
            </aside>
          </div>
        )
      ) : assessment.kind === "typing" ? (
        <section className="hub-card">
          <h2>{finished ? "Typing results" : "Type the passage below"}</h2>
          <p className="demo-passage">{assessment.passage}</p>
          <label htmlFor="demo-typing">Your typed text</label>
          <textarea
            id="demo-typing"
            className="demo-textarea"
            value={typed}
            disabled={finished}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Start typing the passage…"
          />
          <p role="status">
            {Math.round(typed.length / 5 / minutes)} WPM · {accuracy}% accuracy
            · {typed.length} characters
          </p>
          {!finished && (
            <button className="a-btn pri" onClick={() => setFinished(true)}>
              Finish typing practice
            </button>
          )}
        </section>
      ) : (
        <section className="hub-card">
          <h2>
            {assessment.kind === "project"
              ? "Project brief"
              : "Interview preparation"}
          </h2>
          <p>{assessment.description}</p>
          <ul>
            {assessment.checklist?.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                assessment.kind === "project" &&
                !repository.startsWith("https://")
              ) {
                setMessage("Use an HTTPS project or repository link.");
                return;
              }
              setFinished(true);
              setMessage(
                "Preview saved for this session. No repository was uploaded and no reviewer was notified.",
              );
            }}
          >
            {assessment.kind === "project" && (
              <>
                <label htmlFor="demo-repository">
                  Project or repository URL
                </label>
                <input
                  id="demo-repository"
                  className="a-search demo-link-input"
                  type="url"
                  required
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  placeholder="https://github.com/your-name/project"
                  disabled={finished}
                />
              </>
            )}
            <label htmlFor="demo-notes">
              {assessment.kind === "interview"
                ? "Your STAR stories and notes"
                : "What you built and how to run it"}
            </label>
            <textarea
              id="demo-notes"
              className="demo-textarea"
              required
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={finished}
              placeholder="Describe your approach and the evidence that it works."
            />
            {!finished && (
              <button className="a-btn pri">
                Save preview{" "}
                {assessment.kind === "project" ? "submission" : "notes"}
              </button>
            )}
            <p role="status">{message}</p>
          </form>
        </section>
      )}
    </>
  );
}
