import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  AdminExam,
  AdminExamAttempt,
  ExamResults,
  ExamResultsRow,
} from "@slate/contracts";
import {
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  LessonContent,
  Panel,
  useData,
} from "@slate/ui";
import { AdminPagination } from "./shell";
import { AdminSelect } from "./select";
import { useExamDialog } from "./exam-dialog";
import { examResultsCsv } from "./exam-utils";

const when = (date: string | null) =>
  date ? new Date(date).toLocaleString("en-IN") : "—";
const statusLabel = (status: string) =>
  ({
    not_started: "Not started",
    in_progress: "In progress",
    submitted: "Submitted",
    grading: "Awaiting grading",
    graded: "Graded",
  })[status] || status;
export function ExamResultsPanel({
  exam,
  busy,
  onAction,
}: {
  exam: AdminExam;
  busy: boolean;
  onAction: (kind: "release-results" | "regrade", revision: number) => void;
}) {
  const results = useData<ExamResults>(
    `exam-results:${exam.id}`,
    `platform/exams/${exam.id}/results`,
  );
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [branch, setBranch] = useState("all"),
    [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState<ExamResultsRow | null>(null);
  const rows = results.data?.rows || [];
  const graded = rows.filter(
    (row) => row.status === "graded" && row.percentage !== null,
  );
  const pending = rows.filter(
    (row) => row.status === "submitted" || row.status === "grading",
  );
  const average = graded.length
    ? Math.round(
        graded.reduce((sum, row) => sum + (row.percentage || 0), 0) /
          graded.length,
      )
    : null;
  const currentExam = results.data?.exam || exam;
  useEffect(() => {
    if (currentExam.status !== "published" || currentExam.resultsReleasedAt) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void results.refetch(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [currentExam.status, currentExam.resultsReleasedAt, results.refetch]);
  const ended =
    currentExam.phase === "ended" ||
    Date.now() >= Date.parse(currentExam.endsAt);
  const releasable =
    currentExam.status === "published" &&
    ended &&
    !rows.some(
      (row) => row.status !== "not_started" && row.status !== "graded",
    ) &&
    !currentExam.resultsReleasedAt;
  const visible = rows.filter(
    (row) =>
      (status === "all" || row.status === status) &&
      (branch === "all" || row.branchCode === branch) &&
      `${row.name} ${row.email} ${row.studentId || ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(visible.length / 25)),
  );
  const branchCodes = [
    ...new Set(
      rows
        .map((row) => row.branchCode)
        .filter((code): code is string => Boolean(code)),
    ),
  ].sort();
  function exportCsv() {
    const url = URL.createObjectURL(
      new Blob([examResultsCsv(visible)], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `exam-results-${exam.id}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="exam-results">
      <div className="exam-results-actions">
        <span
          className={`badge ${currentExam.resultsReleasedAt ? "green" : ""}`}
        >
          {currentExam.resultsReleasedAt
            ? "Results released"
            : "Results private"}
        </span>
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={results.isFetching}
            onClick={() => {
              void results.refetch();
            }}
          >
            {results.isFetching ? "Refreshing…" : "Refresh results"}
          </button>
          {exam.codingGrading === "automatic" && pending.length > 0 && (
            <button
              type="button"
              className="btn"
              disabled={busy || !ended}
              onClick={() => onAction("regrade", currentExam.revision)}
            >
              Retry pending grading
            </button>
          )}
          <button
            className="btn primary"
            disabled={
              busy || !releasable || results.isPending || results.isError
            }
            onClick={() => onAction("release-results", currentExam.revision)}
          >
            Release results
          </button>
        </div>
      </div>
      {!currentExam.resultsReleasedAt && (
        <p className="exam-info">
          {!ended
            ? "Results can be released after the exam closes."
            : pending.length || rows.some((row) => row.status === "in_progress")
              ? `${pending.length} attempts are awaiting grading. Complete grading for all started attempts before releasing results.`
              : "All completed scores stay private until you release results."}
          {exam.codingGrading === "manual" &&
            pending.length > 0 &&
            " Open an attempt below to review its coding answers and award marks."}
        </p>
      )}
      <DataState pending={results.isPending} error={results.error}>
        <div className="exam-stats">
          <div>
            <span>Assigned students</span>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <span>Started</span>
            <strong>{rows.filter((row) => row.attemptId).length}</strong>
          </div>
          <div>
            <span>Fully graded</span>
            <strong>{graded.length}</strong>
          </div>
          <div>
            <span>Average score</span>
            <strong>{average === null ? "—" : `${average}%`}</strong>
          </div>
        </div>
        <div className="exam-analytics">
          <Panel title="Score distribution">
            <div className="exam-score-chart" aria-label="Score distribution">
              {[0, 20, 40, 60, 80].map((min) => {
                const count = graded.filter(
                  (row) =>
                    (row.percentage || 0) >= min &&
                    (min === 80
                      ? (row.percentage || 0) <= 100
                      : (row.percentage || 0) < min + 20),
                ).length;
                return (
                  <div key={min}>
                    <span>{count}</span>
                    <div
                      style={{
                        height: `${Math.max(3, graded.length ? (120 * count) / graded.length : 3)}px`,
                      }}
                    />
                    <small>
                      {min}–{min === 80 ? 100 : min + 19}%
                    </small>
                  </div>
                );
              })}
            </div>
            {!graded.length && (
              <p className="muted">Scores appear here after grading.</p>
            )}
          </Panel>
          <Panel title="Participation">
            <div className="exam-participation">
              {[
                "not_started",
                "in_progress",
                "submitted",
                "grading",
                "graded",
              ].map((state) => {
                const count = rows.filter((row) => row.status === state).length;
                return (
                  <div key={state}>
                    <span>{statusLabel(state)}</span>
                    <div>
                      <i
                        style={{
                          width: `${rows.length ? (count * 100) / rows.length : 0}%`,
                        }}
                      />
                    </div>
                    <strong>{count}</strong>
                  </div>
                );
              })}
            </div>
            <p className="muted">
              {graded.filter((row) => row.passed).length} passed ·{" "}
              {graded.filter((row) => row.passed === false).length} below the
              passing score
            </p>
          </Panel>
        </div>
        <Panel
          title="Student roster & attempts"
          action={
            <button
              className="btn"
              type="button"
              disabled={!visible.length}
              onClick={exportCsv}
            >
              Export filtered CSV ↓
            </button>
          }
        >
          <div className="exam-result-filters">
            <Field label="Find a student">
              <input
                type="search"
                value={search}
                placeholder="Name, email or student ID"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
            <Field label="Attempt status">
              <AdminSelect
                aria-label="Attempt status"
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "All statuses" },
                  ...[
                    "not_started",
                    "in_progress",
                    "submitted",
                    "grading",
                    "graded",
                  ].map((value) => ({ value, label: statusLabel(value) })),
                ]}
              />
            </Field>
            <Field label="Branch">
              <AdminSelect
                aria-label="Results branch"
                value={branch}
                onChange={(value) => {
                  setBranch(value);
                  setPage(1);
                }}
                options={[
                  { value: "all", label: "All branches" },
                  ...branchCodes.map((code) => ({ value: code, label: code })),
                ]}
              />
            </Field>
          </div>
          {visible.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Score</th>
                      <th>Events</th>
                      <th>Attempt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible
                      .slice((currentPage - 1) * 25, currentPage * 25)
                      .map((row) => (
                        <tr key={row.memberId}>
                          <td>
                            <strong>{row.name}</strong>
                            <small>{row.email}</small>
                            <small>{row.studentId || "—"}</small>
                          </td>
                          <td>
                            {row.branchName || "Unassigned"}
                            <small>{row.branchCode || ""}</small>
                          </td>
                          <td>
                            <span className="badge">
                              {statusLabel(row.status)}
                            </span>
                            <small>
                              {row.passed === null
                                ? ""
                                : row.passed
                                  ? "Passed"
                                  : "Below passing score"}
                            </small>
                          </td>
                          <td>
                            {row.earnedPoints === null
                              ? "—"
                              : `${row.earnedPoints} / ${row.totalPoints}`}
                            <small>
                              {row.percentage === null
                                ? "Pending"
                                : `${row.percentage}%`}
                            </small>
                          </td>
                          <td>
                            {row.eventCount}
                            <small>Recorded events</small>
                          </td>
                          <td>
                            {row.attemptId ? (
                              <button
                                type="button"
                                className="btn"
                                onClick={() => setAttempt(row)}
                              >
                                {exam.codingGrading === "manual" &&
                                row.status !== "graded" &&
                                row.status !== "in_progress"
                                  ? "Review & grade"
                                  : "View attempt"}
                              </button>
                            ) : (
                              <span className="muted">No attempt</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination
                page={currentPage}
                total={visible.length}
                size={25}
                onChange={setPage}
              />
            </>
          ) : (
            <Empty title="No matching students">
              Try another filter or refresh the exam roster.
            </Empty>
          )}
        </Panel>
      </DataState>
      {attempt && (
        <AttemptReview
          key={attempt.attemptId}
          exam={exam}
          row={attempt}
          onClose={() => setAttempt(null)}
          onSaved={() => {
            void results.refetch();
          }}
        />
      )}
    </div>
  );
}

function AttemptReview({
  exam,
  row,
  onClose,
  onSaved,
}: {
  exam: AdminExam;
  row: ExamResultsRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const detail = useData<AdminExamAttempt>(
    `exam-attempt:${exam.id}:${row.attemptId}`,
    `platform/exams/${exam.id}/attempts/${row.attemptId}`,
  );
  const client = useQueryClient();
  const [pending, setPending] = useState(false),
    [dirty, setDirty] = useState(false);
  const close = () => {
    if (
      !pending &&
      (!dirty || window.confirm("Discard unsaved marks and feedback?"))
    )
      onClose();
  };
  const dialog = useExamDialog(true, close, pending);
  return (
    <div className="exam-modal-backdrop">
      <section
        ref={dialog}
        tabIndex={-1}
        className="exam-modal exam-attempt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exam-attempt-title"
      >
        <header>
          <div>
            <h2 id="exam-attempt-title">{row.name}</h2>
            <p>
              {row.email} · {row.studentId || "No student ID"}
            </p>
          </div>
          <button
            type="button"
            className="btn"
            aria-label="Close attempt"
            disabled={pending}
            onClick={close}
          >
            ×
          </button>
        </header>
        <div className="exam-modal-body">
          <DataState pending={detail.isPending} error={detail.error}>
            {detail.data && (
              <AttemptContent
                key={`${detail.data.id}:${detail.data.revision}`}
                exam={exam}
                attempt={detail.data}
                onPending={setPending}
                onDirty={setDirty}
                onSaved={(updated) => {
                  client.setQueryData(
                    ["platform", `exam-attempt:${exam.id}:${row.attemptId}`],
                    updated,
                  );
                  onSaved();
                }}
                reload={() => detail.refetch()}
              />
            )}
          </DataState>
        </div>
      </section>
    </div>
  );
}

function AttemptContent({
  exam,
  attempt,
  onSaved,
  reload,
  onPending,
  onDirty,
}: {
  exam: AdminExam;
  attempt: AdminExamAttempt;
  onSaved: (updated: AdminExamAttempt) => void;
  reload: () => unknown;
  onPending: (pending: boolean) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const coding = exam.questions.filter((q) => q.kind === "coding");
  const [scores, setScores] = useState(() =>
    coding.map((question) => {
      const result = attempt.result.questions.find(
        (item) => item.questionId === question.id,
      );
      return {
        questionId: question.id,
        points:
          result?.earnedPoints === null || result?.earnedPoints === undefined
            ? ""
            : String(result.earnedPoints),
        feedback: result?.explanation || "",
      };
    }),
  );
  const [error, setError] = useState("");
  const grade = useMutation({
    mutationFn: () =>
      api<AdminExamAttempt>(
        `platform/exams/${exam.id}/attempts/${attempt.id}/grade`,
        "POST",
        {
          revision: attempt.revision,
          scores: scores.map((score) => ({
            ...score,
            points: Number(score.points),
          })),
        },
      ),
    onSuccess: onSaved,
  });
  const editable =
    exam.codingGrading === "manual" &&
    exam.status === "published" &&
    !exam.resultsReleasedAt &&
    (attempt.status === "submitted" || attempt.status === "graded") &&
    coding.length > 0;
  const initialScores = coding.map((question) => {
    const result = attempt.result.questions.find(
      (item) => item.questionId === question.id,
    );
    return {
      questionId: question.id,
      points:
        result?.earnedPoints === null || result?.earnedPoints === undefined
          ? ""
          : String(result.earnedPoints),
      feedback: result?.explanation || "",
    };
  });
  const dirty =
    editable && JSON.stringify(scores) !== JSON.stringify(initialScores);
  useEffect(() => onPending(grade.isPending), [grade.isPending, onPending]);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (grade.isPending || dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [grade.isPending, dirty]);
  return (
    <>
      <div className="exam-attempt-summary">
        <span className="badge">{statusLabel(attempt.status)}</span>
        <span>Started {when(attempt.startedAt)}</span>
        <span>Submitted {when(attempt.submittedAt)}</span>
        <strong>
          {attempt.result.earnedPoints === null
            ? "Awaiting grading"
            : `${attempt.result.earnedPoints} / ${attempt.result.totalPoints} points`}
        </strong>
      </div>
      {editable && (
        <p className="exam-info">
          Review the submitted source, prompt and test cases. Award marks for
          each coding question. Multiple-choice scores are already calculated
          and remain unchanged.
        </p>
      )}
      {exam.questions.map((question, index) => {
        const answer = attempt.answers.find(
            (item) => item.questionId === question.id,
          ),
          result = attempt.result.questions.find(
            (item) => item.questionId === question.id,
          ),
          score = scores.find((item) => item.questionId === question.id);
        return (
          <section className="exam-answer-review" key={question.id}>
            <header>
              <h3>
                {index + 1}. {question.title}
              </h3>
              <span className="badge">
                {result?.earnedPoints === null ||
                result?.earnedPoints === undefined
                  ? "Pending"
                  : result.earnedPoints}{" "}
                / {question.points}
              </span>
            </header>
            <LessonContent body={question.prompt} format="markdown" />
            {question.kind === "mcq" ? (
              <>
                <p>
                  <strong>Student answer:</strong>{" "}
                  {answer?.selectedOption === null ||
                  answer?.selectedOption === undefined
                    ? "Not answered"
                    : question.options[answer.selectedOption] ||
                      "Invalid selection"}
                </p>
                <p>
                  <strong>Correct answer:</strong>{" "}
                  {question.options[question.correctOption]}
                </p>
                {question.explanation && <p>{question.explanation}</p>}
              </>
            ) : (
              <>
                <p>
                  <strong>Submitted language:</strong>{" "}
                  {answer?.language || "No language selected"}
                </p>
                <pre className="exam-source">
                  {answer?.code || "No source code submitted."}
                </pre>
                <details>
                  <summary>
                    Grading test cases ({question.testCases.length})
                  </summary>
                  {question.testCases.map((test, i) => (
                    <div className="exam-test" key={test.id}>
                      <strong>
                        Test {i + 1} · {test.hidden ? "Hidden" : "Public"}
                      </strong>
                      <div className="form-grid">
                        <div>
                          <small>Input</small>
                          <pre>{test.input || "(empty)"}</pre>
                        </div>
                        <div>
                          <small>Expected output</small>
                          <pre>{test.output || "(empty)"}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </details>
                {editable && score ? (
                  <div className="exam-manual-score">
                    <Field
                      label={`Marks for question ${index + 1} (out of ${question.points})`}
                    >
                      <input
                        aria-label={`Marks for question ${index + 1}`}
                        type="number"
                        min={0}
                        max={question.points}
                        step={0.01}
                        value={score.points}
                        disabled={grade.isPending}
                        onChange={(event) =>
                          setScores((current) =>
                            current.map((item) =>
                              item.questionId === question.id
                                ? { ...item, points: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field label="Feedback for student">
                      <textarea
                        maxLength={5000}
                        rows={3}
                        disabled={grade.isPending}
                        value={score.feedback}
                        onChange={(event) =>
                          setScores((current) =>
                            current.map((item) =>
                              item.questionId === question.id
                                ? { ...item, feedback: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                ) : (
                  result?.explanation && (
                    <p>
                      <strong>Feedback:</strong> {result.explanation}
                    </p>
                  )
                )}
              </>
            )}
            <p className="muted">
              {result?.verdict || "No grading result yet"}
            </p>
          </section>
        );
      })}
      {editable && (
        <section className="exam-grade-actions">
          <ErrorMessage
            error={grade.error || (error ? new Error(error) : null)}
          />
          {grade.error && (
            <button
              type="button"
              className="link"
              onClick={() => {
                if (
                  window.confirm(
                    "Reload the latest attempt? Unsaved marks will be discarded.",
                  )
                )
                  reload();
              }}
            >
              Reload latest attempt
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={grade.isPending}
            onClick={() => {
              const invalid = scores.some(
                (score) =>
                  !score.points.trim() ||
                  !Number.isFinite(Number(score.points)) ||
                  Number(score.points) < 0 ||
                  Number(score.points) >
                    (coding.find((q) => q.id === score.questionId)?.points ||
                      0),
              );
              if (invalid) {
                setError(
                  "Enter valid marks for every coding question, within its maximum points.",
                );
                return;
              }
              setError("");
              grade.mutate();
            }}
          >
            {grade.isPending ? "Saving marks…" : "Save coding marks"}
          </button>
          <p className="muted">
            Saving marks does not release results. Release them separately after
            the exam closes.
          </p>
        </section>
      )}
      <section className="exam-monitoring-log">
        <h3>Browser monitoring · {attempt.events.length} events</h3>
        <p className="muted">
          These browser events provide context for review. They do not
          independently establish misconduct.
        </p>
        {attempt.events.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Student device time</th>
                  <th>Received at</th>
                </tr>
              </thead>
              <tbody>
                {attempt.events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.type.replaceAll("_", " ")}</td>
                    <td>{when(event.occurredAt)}</td>
                    <td>{when(event.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No browser events recorded.</p>
        )}
      </section>
    </>
  );
}
