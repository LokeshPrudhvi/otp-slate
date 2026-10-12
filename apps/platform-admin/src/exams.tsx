import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import type {
  AdminExam,
  ExamAdminSummary,
  ExamAudienceOptions,
  ExamDraft,
  Organization,
} from "@slate/contracts";
import {
  api,
  ApiError,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  LessonContent,
  Panel,
  useData,
} from "@slate/ui";
import { AdminPage } from "./page";
import { AdminPagination } from "./shell";
import { AdminSelect } from "./select";
import { useExamDialog } from "./exam-dialog";
import { ExamBuilder } from "./exam-builder";
import { ExamResultsPanel } from "./exam-results";
import { examDraftFrom, newExamDraft, validateExamDraft } from "./exam-utils";
import "./exams.css";

const dateTime = (value: string) =>
  new Date(value).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
const phase = (exam: ExamAdminSummary) =>
  exam.status === "published" ? exam.phase : exam.status;
export function Exams() {
  const [params, setParams] = useSearchParams();
  const organizationId = params.get("organizationId") || "";
  const organizations = useData<Organization[]>(
    "organizations",
    "platform/organizations",
  );
  const exams = useData<ExamAdminSummary[]>(
    `exams:${organizationId}`,
    `platform/exams${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`,
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void exams.refetch();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [exams.refetch]);
  const [status, setStatus] = useState("all"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const rows = (exams.data || []).filter(
    (exam) =>
      (status === "all" || phase(exam) === status) &&
      `${exam.title} ${exam.organizationName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 12)));
  return (
    <AdminPage
      title="Live exams"
      description="Create assessments, assign an audience and review student performance."
      className="exams-page"
      action={
        <div className="admin-header-tools">
          <div className="admin-header-select">
            <Field label="Organization">
              <AdminSelect
                aria-label="Exam organization filter"
                searchable
                value={organizationId}
                onChange={(value) => {
                  setParams(value ? { organizationId: value } : {});
                  setPage(1);
                }}
                options={[
                  { value: "", label: "All organizations" },
                  ...(organizations.data || []).map((org) => ({
                    value: org.id,
                    label: org.name,
                  })),
                ]}
              />
            </Field>
          </div>
          <Link
            className="btn"
            to={`/exams/new${organizationId ? `?organizationId=${organizationId}` : ""}`}
          >
            + Create exam
          </Link>
        </div>
      }
    >
      <div className="exam-stats">
        {[
          [
            "Drafts",
            (exams.data || []).filter((exam) => exam.status === "draft").length,
          ],
          [
            "Live now",
            (exams.data || []).filter((exam) => phase(exam) === "live").length,
          ],
          [
            "Upcoming",
            (exams.data || []).filter((exam) => phase(exam) === "upcoming")
              .length,
          ],
          [
            "Completed",
            (exams.data || []).filter((exam) => phase(exam) === "ended").length,
          ],
        ].map(([label, count]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
          </div>
        ))}
      </div>
      <Panel
        title="Exam schedule"
        action={
          <button
            type="button"
            className="btn"
            disabled={exams.isFetching}
            onClick={() => {
              void exams.refetch();
            }}
          >
            {exams.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        }
      >
        <div className="exam-list-filters">
          <Field label="Search exams">
            <input
              type="search"
              value={search}
              placeholder="Title or organization"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Status">
            <AdminSelect
              aria-label="Exam status filter"
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={[
                "all",
                "draft",
                "upcoming",
                "live",
                "ended",
                "cancelled",
              ].map((value) => ({
                value,
                label:
                  value === "all"
                    ? "All statuses"
                    : value[0].toUpperCase() + value.slice(1),
              }))}
            />
          </Field>
        </div>
        <DataState
          pending={exams.isPending}
          error={exams.error || organizations.error}
        >
          {rows.length ? (
            <>
              <div className="exam-index-grid">
                {rows
                  .slice((currentPage - 1) * 12, currentPage * 12)
                  .map((exam) => (
                    <Link
                      className="exam-index-card"
                      to={`/exams/${exam.id}`}
                      key={exam.id}
                    >
                      <div>
                        <span
                          className={`badge ${phase(exam) === "live" ? "green" : ""}`}
                        >
                          {phase(exam)}
                        </span>
                        <small>{exam.organizationName}</small>
                      </div>
                      <h3>{exam.title}</h3>
                      <p>{exam.description || "Timed assessment"}</p>
                      <dl>
                        <div>
                          <dt>Opens</dt>
                          <dd>{dateTime(exam.startsAt)}</dd>
                        </div>
                        <div>
                          <dt>Format</dt>
                          <dd>
                            {exam.questionCount} questions ·{" "}
                            {exam.durationMinutes} minutes
                          </dd>
                        </div>
                        <div>
                          <dt>Audience</dt>
                          <dd>
                            {exam.status === "draft"
                              ? "Selected when published"
                              : `${exam.audienceCount} students · ${exam.submittedCount} submitted`}
                          </dd>
                        </div>
                      </dl>
                      <span className="exam-card-link">
                        {exam.status === "draft"
                          ? "Continue editing"
                          : "View exam & results"}{" "}
                        →
                      </span>
                    </Link>
                  ))}
              </div>
              <AdminPagination
                page={currentPage}
                total={rows.length}
                size={12}
                onChange={setPage}
              />
            </>
          ) : (
            <Empty
              title={
                search || status !== "all"
                  ? "No matching exams"
                  : "Your next exam starts here"
              }
              action={
                <Link
                  className="btn primary"
                  to={`/exams/new${organizationId ? `?organizationId=${organizationId}` : ""}`}
                >
                  Create exam
                </Link>
              }
            >
              Build multiple-choice and coding assessments, select their
              audience and publish when ready.
            </Empty>
          )}
        </DataState>
      </Panel>
    </AdminPage>
  );
}

function ExamPreview({ exam }: { exam: ExamDraft }) {
  return (
    <div className="exam-preview">
      <div className="exam-stats">
        <div>
          <span>Questions</span>
          <strong>{exam.questions.length}</strong>
        </div>
        <div>
          <span>Points</span>
          <strong>
            {exam.questions.reduce((sum, q) => sum + q.points, 0)}
          </strong>
        </div>
        <div>
          <span>Duration</span>
          <strong>{exam.durationMinutes} min</strong>
        </div>
        <div>
          <span>Pass score</span>
          <strong>{exam.passingPercentage}%</strong>
        </div>
      </div>
      <p>{exam.description}</p>
      <p>
        <strong>Exam window:</strong> {dateTime(exam.startsAt)} —{" "}
        {dateTime(exam.endsAt)}
      </p>
      <p>
        <strong>Audience:</strong>{" "}
        {exam.audience.mode === "organization"
          ? "Entire organization"
          : exam.audience.mode === "branches"
            ? `${exam.audience.branchCodes.length} selected branches (${exam.audience.branchCodes.join(", ")})`
            : `${exam.audience.studentIds.length} selected students`}
      </p>
      <p>
        <strong>Coding grading:</strong> Manual review by admin ·{" "}
        <strong>Monitoring:</strong>{" "}
        {exam.monitoring.enabled
          ? `Enabled${exam.monitoring.requireFullscreen ? " · Full screen required" : ""}${exam.monitoring.recordClipboard ? " · Clipboard events recorded" : ""}`
          : "Disabled"}
      </p>
      <h3>Instructions</h3>
      <LessonContent
        body={exam.instructions || "No additional instructions."}
        format="markdown"
      />
      {exam.questions.map((q, index) => (
        <details className="exam-preview-question" key={q.id}>
          <summary>
            {index + 1}. {q.title}{" "}
            <span>
              {q.kind === "mcq" ? "Multiple choice" : "Coding"} · {q.points}{" "}
              points
            </span>
          </summary>
          <LessonContent body={q.prompt} format="markdown" />
          {q.kind === "mcq" ? (
            <>
              <ol type="A">
                {q.options.map((option, i) => (
                  <li key={i}>
                    {option}
                    {i === q.correctOption && (
                      <strong> ✓ Correct answer</strong>
                    )}
                  </li>
                ))}
              </ol>
              {q.explanation && <p>{q.explanation}</p>}
            </>
          ) : (
            <>
              <p>Languages: {q.languages.join(", ")}</p>
              {q.testCases.map((test, i) => (
                <div className="exam-test" key={test.id}>
                  <strong>
                    Test {i + 1} · {test.hidden ? "Hidden" : "Public example"}
                  </strong>
                  <div className="form-grid">
                    <pre>{test.input || "(empty input)"}</pre>
                    <pre>{test.output || "(empty output)"}</pre>
                  </div>
                </div>
              ))}
            </>
          )}
        </details>
      ))}
    </div>
  );
}

export function ExamEditor() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const exam = useData<AdminExam>(
    `exam:${id}`,
    `platform/exams/${id}`,
    Boolean(id),
  );
  const organizations = useData<Organization[]>(
    "organizations",
    "platform/organizations",
  );
  return (
    <DataState pending={Boolean(id) && exam.isPending} error={exam.error}>
      <ExamEditorState
        key={id || "new"}
        initial={exam.data}
        requestedOrganizationId={params.get("organizationId") || ""}
        organizations={organizations.data || []}
        organizationsError={organizations.error}
      />
    </DataState>
  );
}

function ExamEditorState({
  initial,
  requestedOrganizationId,
  organizations,
  organizationsError,
}: {
  initial?: AdminExam;
  requestedOrganizationId: string;
  organizations: Organization[];
  organizationsError: unknown;
}) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() =>
    initial ? examDraftFrom(initial) : newExamDraft(requestedOrganizationId),
  );
  const [clientId] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<string[]>([]),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"details" | "results">("details");
  const [confirm, setConfirm] = useState<
    "publish" | "cancel" | "release-results" | null
  >(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const issuesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length) {
      issuesRef.current?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      issuesRef.current?.focus({ preventScroll: true });
    }
  }, [errors]);
  const audience = useData<ExamAudienceOptions>(
    `exam-audience:${draft.organizationId}`,
    `platform/exams/audience?organizationId=${encodeURIComponent(draft.organizationId)}`,
    Boolean(draft.organizationId),
  );
  const editable = !saved || saved.status === "draft";
  const initialDraft = useRef(JSON.stringify(draft));
  const dirty =
    editable &&
    JSON.stringify(draft) !==
      (saved ? JSON.stringify(examDraftFrom(saved)) : initialDraft.current);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const organization = organizations.find(
    (org) => org.id === draft.organizationId,
  );
  const archived = organization?.status === "archived";
  const save = useMutation({
    mutationFn: () =>
      saved
        ? api<AdminExam>(`platform/exams/${saved.id}`, "PATCH", {
            revision: saved.revision,
            ...examDraftFrom(draft),
          })
        : api<AdminExam>("platform/exams", "POST", {
            clientId,
            ...examDraftFrom(draft),
          }),
    onSuccess: (value) => {
      setSaved(value);
      setDraft(examDraftFrom(value));
      setNotice("Draft saved. Review it before publishing.");
      setErrors([]);
      dirtyRef.current = false;
      client.setQueryData(["platform", `exam:${value.id}`], value);
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "platform" &&
          typeof query.queryKey[1] === "string" &&
          query.queryKey[1].startsWith("exams:"),
      });
      if (!saved) navigate(`/exams/${value.id}`, { replace: true });
    },
  });
  const action = useMutation({
    mutationFn: ({
      kind,
      revision,
    }: {
      kind: "publish" | "cancel" | "release-results";
      revision?: number;
    }) =>
      api<AdminExam>(`platform/exams/${saved!.id}/${kind}`, "POST", {
        revision: revision ?? saved!.revision,
      }),
    onSuccess: (value, input) => {
      setSaved(value);
      setDraft(examDraftFrom(value));
      setConfirm(null);
      setNotice(
        input.kind === "publish"
          ? `Exam published to ${value.audienceCount} students. The roster is now fixed.`
          : input.kind === "cancel"
            ? "Exam cancelled. It can no longer be started."
            : "Results released to students.",
      );
      client.setQueryData(["platform", `exam:${value.id}`], value);
      void client.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "platform" &&
          typeof query.queryKey[1] === "string" &&
          (query.queryKey[1].startsWith("exams:") ||
            query.queryKey[1].startsWith(`exam-results:${value.id}`)),
      });
    },
  });
  const busy = save.isPending || action.isPending;
  const confirmationDialog = useExamDialog(
    Boolean(confirm),
    () => setConfirm(null),
    busy,
  );
  const discardDialog = useExamDialog(Boolean(pendingHref), () =>
    setPendingHref(null),
  );
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busy) event.preventDefault();
    };
    const links = (event: MouseEvent) => {
      if (!dirtyRef.current && !busy) return;
      if (
        event.button ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      const next = new URL(anchor.href);
      if (next.origin !== location.origin || next.href === location.href)
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!busy) setPendingHref(`${next.pathname}${next.search}${next.hash}`);
    };
    window.addEventListener("beforeunload", before);
    document.addEventListener("click", links, true);
    return () => {
      window.removeEventListener("beforeunload", before);
      document.removeEventListener("click", links, true);
    };
  }, [busy]);
  function saveDraft() {
    const issues = validateExamDraft(draft);
    if (!audience.data || audience.isError)
      issues.push("Load the organization’s current audience before saving.");
    if (archived)
      issues.push("Restore this organization before updating exams.");
    setErrors(issues);
    if (!issues.length && !busy) save.mutate();
  }
  async function reload() {
    if (
      dirtyRef.current &&
      !window.confirm("Reload the saved exam and discard this unsaved draft?")
    )
      return;
    if (!saved) return;
    try {
      const latest = await api<AdminExam>(`platform/exams/${saved.id}`);
      setSaved(latest);
      setDraft(examDraftFrom(latest));
      save.reset();
      action.reset();
      setNotice("Loaded the latest saved exam.");
    } catch (cause) {
      setErrors([
        cause instanceof Error ? cause.message : "Could not reload the exam.",
      ]);
    }
  }
  return (
    <AdminPage
      title={saved?.title || "Create live exam"}
      description={
        saved
          ? `${saved.organizationName} · ${phase(saved)}${saved.resultsReleasedAt ? " · Results released" : ""}`
          : "Build the assessment, choose its audience and schedule it."
      }
      className="exams-page"
      action={
        <div className="admin-header-tools">
          <Link className="btn" to="/exams">
            ← All exams
          </Link>
          {editable && (
            <button
              className="btn"
              type="button"
              disabled={busy || archived}
              onClick={saveDraft}
            >
              {save.isPending ? "Saving…" : "Save draft"}
            </button>
          )}
          {saved?.status === "draft" && (
            <button
              className="btn primary"
              type="button"
              disabled={busy || dirty || archived}
              onClick={() => {
                action.reset();
                setConfirm("publish");
              }}
            >
              Review & publish
            </button>
          )}
        </div>
      }
    >
      <ErrorMessage error={organizationsError} />
      {notice && (
        <p className="success-note" role="status">
          {notice}
        </p>
      )}
      <ErrorMessage error={save.error || action.error} />
      {((save.error instanceof ApiError && save.error.status === 409) ||
        (action.error instanceof ApiError && action.error.status === 409)) && (
        <p className="exam-info">
          This exam changed or could not complete the action. Your draft is
          preserved.{" "}
          <button
            className="link"
            type="button"
            onClick={() => {
              void reload();
            }}
          >
            Reload saved exam
          </button>
        </p>
      )}
      {!!errors.length && (
        <div ref={issuesRef} tabIndex={-1} className="exam-issues" role="alert">
          <strong>Review these items:</strong>
          <ul>
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
      {archived && (
        <p className="exam-info">
          This organization is archived. Restore it before editing or publishing
          an exam.
        </p>
      )}
      {saved && saved.status !== "draft" && (
        <div className="exam-detail-tabs">
          <div role="group" aria-label="Exam view">
            <button
              type="button"
              aria-pressed={tab === "details"}
              className="btn"
              onClick={() => setTab("details")}
            >
              Exam details
            </button>
            <button
              type="button"
              aria-pressed={tab === "results"}
              className="btn"
              onClick={() => setTab("results")}
            >
              Results & attempts
            </button>
          </div>
          {saved.status === "published" && !saved.resultsReleasedAt && (
            <button
              type="button"
              className="btn exam-danger"
              disabled={busy}
              onClick={() => {
                action.reset();
                setConfirm("cancel");
              }}
            >
              Cancel exam
            </button>
          )}
        </div>
      )}
      {editable ? (
        <>
          <div className="exam-organization">
            <Field label="Organization">
              <AdminSelect
                aria-label="Exam organization"
                disabled={busy || Boolean(saved)}
                searchable
                value={draft.organizationId}
                onChange={(organizationId) => {
                  setDraft((current) => ({
                    ...current,
                    organizationId,
                    audience: {
                      mode: "organization",
                      branchCodes: [],
                      studentIds: [],
                    },
                  }));
                  setErrors([]);
                }}
                options={[
                  { value: "", label: "Choose an active organization" },
                  ...organizations
                    .filter(
                      (org) =>
                        org.status === "active" ||
                        org.id === saved?.organizationId,
                    )
                    .map((org) => ({ value: org.id, label: org.name })),
                ]}
              />
            </Field>
            {saved && (
              <span className="muted">
                An exam stays with its original organization.
              </span>
            )}
          </div>
          <DataState
            pending={Boolean(draft.organizationId) && audience.isPending}
            error={audience.error}
          >
            <fieldset className="exam-edit-fields" disabled={busy || archived}>
              <ExamBuilder
                value={draft}
                onChange={setDraft}
                audience={audience.data}
                disabled={busy || archived}
              />
            </fieldset>
          </DataState>
          <div className="exam-save-bar">
            <span>
              {dirty
                ? "Unsaved draft changes"
                : saved
                  ? "Draft saved"
                  : "Ready to build"}
              <small>Students see the exam only after publication.</small>
            </span>
            <button
              type="button"
              className="btn primary"
              disabled={busy || archived}
              onClick={saveDraft}
            >
              {save.isPending ? "Saving…" : "Save draft"}
            </button>
          </div>
        </>
      ) : saved && tab === "results" ? (
        <ExamResultsPanel
          exam={saved}
          busy={busy}
          onAction={(kind, revision) => {
            if (kind === "release-results") {
              setSaved((current) =>
                current ? { ...current, revision } : current,
              );
              action.reset();
              setConfirm(kind);
            } else action.mutate({ kind, revision });
          }}
        />
      ) : (
        saved && (
          <Panel title="Published assessment">
            <p className="exam-info">
              Published content and its audience are fixed. Create a new exam
              for a revised assessment.
            </p>
            <ExamPreview exam={saved} />
          </Panel>
        )
      )}
      {confirm && saved && (
        <div className="exam-modal-backdrop">
          <section
            ref={confirmationDialog}
            tabIndex={-1}
            className="exam-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-confirm-title"
          >
            <header>
              <h2 id="exam-confirm-title">
                {confirm === "publish"
                  ? "Review and publish exam"
                  : confirm === "cancel"
                    ? "Cancel this exam?"
                    : "Release results to students?"}
              </h2>
              <button
                className="btn"
                type="button"
                aria-label="Close confirmation"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                ×
              </button>
            </header>
            <div className="exam-modal-body">
              {confirm === "publish" ? (
                <>
                  <p className="exam-info">
                    Publishing fixes the eligible student roster and locks the
                    questions, schedule and scoring rules. Check everything
                    before continuing.
                  </p>
                  <ExamPreview exam={saved} />
                </>
              ) : (
                <p>
                  {confirm === "cancel"
                    ? "Students will no longer be able to start or continue this exam. Existing attempts remain available for review."
                    : "Students will be able to view their scores and feedback. Release is allowed only after the exam closes and every started attempt is fully graded."}
                </p>
              )}
              <ErrorMessage error={action.error} />
            </div>
            <footer>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Keep reviewing
              </button>
              <button
                className={`btn primary ${confirm === "cancel" ? "exam-danger" : ""}`}
                type="button"
                disabled={busy}
                onClick={() => action.mutate({ kind: confirm })}
              >
                {action.isPending
                  ? "Updating…"
                  : confirm === "publish"
                    ? "Publish exam"
                    : confirm === "cancel"
                      ? "Cancel exam"
                      : "Release results"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {pendingHref && (
        <div className="exam-modal-backdrop">
          <section
            ref={discardDialog}
            tabIndex={-1}
            className="exam-modal exam-small-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exam-discard-title"
          >
            <h2 id="exam-discard-title">Discard this exam draft?</h2>
            <p>Your latest changes have not been saved.</p>
            <div className="actions">
              <button
                autoFocus
                className="btn primary"
                onClick={() => setPendingHref(null)}
              >
                Keep editing
              </button>
              <button
                className="btn"
                onClick={() => {
                  dirtyRef.current = false;
                  navigate(pendingHref);
                }}
              >
                Discard changes
              </button>
            </div>
          </section>
        </div>
      )}
    </AdminPage>
  );
}
