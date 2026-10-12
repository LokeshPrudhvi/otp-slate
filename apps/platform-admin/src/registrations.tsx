import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { Organization } from "@slate/contracts";
import {
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  Panel,
  useData,
} from "@slate/ui";
import "./registrations.css";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import { BranchFields, selectedOrganizationBranch, useOrganizationBranches } from "./student-branches";
import { buildStudentTemplate, columns, fieldKeys, readStudentFile, validateRows, type ImportRow, type PreviewRow } from "./student-import";

type ReviewStatus = "pending" | "approved" | "rejected" | "all";
type RequestRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  studentId: string;
  name: string;
  email: string;
  phone: string;
  branchName: string;
  branchCode: string;
  cohort: string | null;
  source: "registration" | "import";
  status: Exclude<ReviewStatus, "all">;
  createdAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  emailStatus:
    "pending" | "processing" | "accepted" | "failed" | "expired" | null;
};
type ImportResult = {
  row: number;
  status: "approved" | "duplicate" | "invalid" | "failed";
  message?: string;
};
const reviewFilters: { value: ReviewStatus; label: string }[] = [
  { value: "pending", label: "Needs approval" },
  { value: "approved", label: "Created accounts" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All records" },
];
const reviewPageSize = 25;
const emailLabels: Record<string, string> = {
  pending: "Email queued",
  processing: "Sending email",
  accepted: "Accepted by provider",
  failed: "Email failed",
  expired: "Email expired",
};

export function refreshStudentData(client: QueryClient, organizationId?: string) {
  void client.invalidateQueries({ predicate: (query) => query.queryKey[0] === "platform" && typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith("registrations-") });
  if (organizationId) {
    void client.invalidateQueries({ queryKey: ["platform", `members-${organizationId}`], exact: true });
    void client.invalidateQueries({ queryKey: ["platform", "access", organizationId], exact: true });
  } else {
    void client.invalidateQueries({ predicate: (query) => query.queryKey[0] === "platform" && typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith("members-") });
    void client.invalidateQueries({ queryKey: ["platform", "access"] });
  }
  void client.invalidateQueries({ queryKey: ["platform", "summary"], exact: true });
}

export function AddStudent({
  organizations,
  initialOrganizationId,
  onComplete,
  onCancel,
  onPending,
  fixedOrganization = false,
}: {
  organizations: Organization[];
  initialOrganizationId: string;
  onComplete: (organizationId: string, name: string) => void;
  onCancel?: () => void;
  onPending: (pending: boolean) => void;
  fixedOrganization?: boolean;
}) {
  const client = useQueryClient();
  const active = organizations.filter((organization) => organization.status === "active");
  const [organizationId, setOrganizationId] = useState(
    active.some((organization) => organization.id === initialOrganizationId) ? initialOrganizationId : "",
  );
  const [details, setDetails] = useState<Omit<ImportRow, "collegeName">>({
    studentId: "", name: "", email: "", phone: "", branchName: "", branchCode: "", cohort: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock = useRef(false);
  const organization = active.find((item) => item.id === organizationId);
  const branchQuery = useOrganizationBranches(organizationId);
  const selectedBranch = selectedOrganizationBranch(branchQuery.data, organizationId, details.branchCode);
  const branchReady = Boolean(selectedBranch) && !branchQuery.isPending && !branchQuery.error;
  const fields: { key: keyof typeof details; label: string; max: number; type?: string; hint?: string }[] = [
    { key: "name", label: "Full name", max: 120 },
    { key: "studentId", label: "Student ID / roll number", max: 80 },
    { key: "email", label: "Student email", type: "email", max: 200, hint: "The welcome email and temporary password will be sent here." },
    { key: "phone", label: "Phone number", type: "tel", max: 30, hint: "Use a country code or a 10-digit Indian mobile number." },
  ];
  async function submit() {
    if (lock.current || !organization || !branchReady || !selectedBranch) return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    setError(null);
    try {
      const input: ImportRow = { ...details, collegeName: organization.name, branchCode: selectedBranch.code, branchName: selectedBranch.name };
      const [validated] = validateRows([columns, fieldKeys.map((key) => input[key])], organization.name, branchQuery.data || []);
      if (validated.errors.length) throw new Error(validated.errors.join(". "));
      const { collegeName: _collegeName, ...fields } = validated.data;
      const result = await api<{ id: string; memberId: string; status: "approved"; emailStatus: "pending" }>("platform/students", "POST", {
        organizationId: organization.id,
        ...fields,
      });
      if (result.status !== "approved") throw new Error("The account could not be created. Refresh the student list before retrying.");
      refreshStudentData(client, organization.id);
      setDetails({ studentId: "", name: "", email: "", phone: "", branchName: "", branchCode: "", cohort: "" });
      onComplete(organization.id, validated.data.name);
    } catch (cause) {
      setError(cause);
    } finally {
      lock.current = false;
      setBusy(false);
      onPending(false);
    }
  }
  return <Panel title="Add a student">
    <p className="registration-help">Create the student account and queue a welcome email with their temporary password. Admin-created accounts do not need another approval. Students must change their password and verify their phone on first login.</p>
    {!active.length ? <Empty title="No active organization available">Create or restore an organization first. <Link to="/organizations">Manage organizations →</Link></Empty> :
      <form aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset className="registration-student-fields" disabled={busy}>
          <Field label="College / organization" hint="The college name is taken from this organization.">
            <AdminSelect aria-label="College / organization" required disabled={fixedOrganization || busy} value={organizationId} onChange={value => { setOrganizationId(value); setDetails(current => ({ ...current, branchName: "", branchCode: "" })); setError(null); }} searchable
              options={[{ value: "", label: "Choose an active organization" }, ...active.map(item => ({ value: item.id, label: item.name }))]} />
          </Field>
          <div className="form-grid">
            {fields.map((field) => <Field key={field.key} label={field.label} hint={field.hint}>
              <input required={field.key !== "cohort"} type={field.type || "text"} maxLength={field.max}
                value={details[field.key]} onChange={(event) => setDetails((current) => ({
                  ...current, [field.key]: event.target.value,
                }))} />
            </Field>)}
            <BranchFields organizationId={organizationId} branches={branchQuery.data} code={details.branchCode}
              onChange={branch => setDetails(current => ({ ...current, branchName: branch?.name || "", branchCode: branch?.code || "" }))}
              pending={branchQuery.isPending} error={branchQuery.error} disabled={busy} onRetry={() => { void branchQuery.refetch(); }} />
            <Field label="Cohort (optional)" hint="For example, Class of 2027."><input maxLength={120} value={details.cohort} onChange={event => setDetails(current => ({ ...current, cohort: event.target.value }))} /></Field>
          </div>
        </fieldset>
        <ErrorMessage error={error} />
        <div className="actions">
          <button className="btn primary" disabled={busy || !organization || !branchReady}>{busy ? "Creating student…" : "Create student & send welcome email"}</button>
          {onCancel && <button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button>}
        </div>
      </form>}
  </Panel>;
}

function BulkImport({
  organizations,
  onComplete,
  onPending,
}: {
  organizations: Organization[];
  onComplete: (organizationId: string) => void;
  onPending: (pending: boolean) => void;
}) {
  const [organizationId, setOrganizationId] = useState(""),
    [preview, setPreview] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState("");
  const [results, setResults] = useState<ImportResult[]>([]),
    [progress, setProgress] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    lock = useRef(false);
  const organization = organizations.find((org) => org.id === organizationId);
  const branchQuery = useOrganizationBranches(organizationId);
  const branches = (branchQuery.data || []).filter(branch => branch.organizationId === organizationId);
  const branchesReady = !!organization && !branchQuery.isPending && !branchQuery.error && branches.length > 0;
  const invalid = preview.filter((row) => row.errors.length),
    active = organizations.filter((org) => org.status === "active");
  async function template() {
    if (lock.current || !organization || !branchesReady) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const workbook = await buildStudentTemplate(organization, branches);
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `student-import-${organization.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (lock.current || !organization || !branchesReady) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setPreview([]);
    setResults([]);
    setProgress(0);
    setFilename(file.name);
    try {
      setPreview(validateRows(await readStudentFile(file, branches), organization.name, branches));
    } catch (cause) {
      setError(cause);
    } finally {
      lock.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function stage() {
    if (lock.current || !branchesReady || !preview.length || invalid.length || results.length)
      return;
    lock.current = true;
    setBusy(true);
    onPending(true);
    setError(null);
    const completed: ImportResult[] = [];
    try {
      for (let start = 0; start < preview.length; start += 25) {
        const batch = preview.slice(start, start + 25);
        const result = await api<{ results: ImportResult[] }>(
          "platform/students/import",
          "POST",
          { organizationId, rows: batch.map((row) => row.data) },
        );
        completed.push(
          ...result.results.map((row) => ({
            ...row,
            row: batch[row.row - 1].line,
          })),
        );
        setResults([...completed]);
        setProgress(Math.min(start + 25, preview.length));
      }
    } catch (cause) {
      setError(cause);
    } finally {
      onComplete(organizationId);
      lock.current = false;
      setBusy(false);
      onPending(false);
    }
  }
  return (
    <Panel
      title="Import students"
      action={
        <button
          type="button"
          className="btn"
          disabled={busy || !branchesReady}
          onClick={template}
        >
          Download Excel template ↓
        </button>
      }
    >
      <p className="muted">
        Upload a student roster and review the preview. The final confirmation creates the accounts and queues their welcome emails. No second approval is needed; uploading alone does not create accounts or send emails.
      </p>
      <div className="registration-import-controls">
        <Field label="College / organization">
          <AdminSelect
            aria-label="College / organization"
            value={organizationId}
            disabled={busy}
            searchable
            onChange={value => {
              setOrganizationId(value);
              setPreview([]);
              setResults([]);
              setFilename("");
              setError(null);
            }}
            options={[{ value: "", label: "Choose an organization" }, ...active.map(org => ({ value: org.id, label: org.name }))]}
          />
        </Field>
        <Field
          label="Student roster"
          hint="Use this organization’s template · Excel or CSV · 2,000 students · 5 MB"
        >
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv"
            disabled={!branchesReady || busy}
            onChange={(event) => {
              if (event.target.files?.[0]) void upload(event.target.files[0]);
            }}
          />
        </Field>
      </div>
      {!!organizationId && branchQuery.isPending && <p role="status">Loading organization branches…</p>}
      {!!organizationId && !!branchQuery.error && <div className="registration-branch-notice"><ErrorMessage error={branchQuery.error} /><button type="button" className="link" onClick={() => { void branchQuery.refetch(); }}>Retry loading branches</button></div>}
      {!!organizationId && !branchQuery.isPending && !branchQuery.error && !branches.length && <p className="registration-branch-notice">Create this organization’s branches before downloading a template or importing students. <Link to={`/access?organizationId=${encodeURIComponent(organizationId)}&tab=branches`}>Manage branches →</Link></p>}
      {branchesReady && <p className="registration-help">The Excel template contains a branch dropdown for {organization?.name}. Branch code fills automatically. CSV files must contain a matching branch name and code.</p>}
      <ErrorMessage error={error} />
      {busy && (
        <p role="status">
          {preview.length
            ? `Creating accounts: ${progress} of ${preview.length} processed…`
            : "Preparing your file…"}
        </p>
      )}
      {!!preview.length && (
        <>
          <div className="registration-preview-head">
            <div>
              <strong>{filename}</strong>
              <p className="muted">
                {preview.length} students ·{" "}
                {invalid.length
                  ? `${invalid.length} rows need correction`
                  : "All rows pass validation"}
              </p>
            </div>
            <button
              className="btn primary"
              disabled={busy || !branchesReady || !!invalid.length || !!results.length}
              onClick={stage}
            >
              {results.length
                ? "Import processed"
                : `Create ${preview.length} ${preview.length === 1 ? "account" : "accounts"} & send emails`}
            </button>
          </div>
          {!!invalid.length && (
            <div className="registration-issues" role="alert">
              <strong>Correct these rows and upload again.</strong>
              <ul>
                {invalid.map((row) => (
                  <li key={row.line}>
                    Row {row.line}: {row.errors.join("; ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <caption className="registration-caption">
                Preview · first {Math.min(preview.length, 20)} of{" "}
                {preview.length} students
              </caption>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Student</th>
                  <th>Contact</th>
                  <th>College & branch</th>
                  <th>Cohort</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 20).map((row) => (
                  <tr key={row.line}>
                    <td>
                      {row.line}
                      {!!row.errors.length && (
                        <small className="registration-error">
                          Needs correction
                        </small>
                      )}
                    </td>
                    <td>
                      <strong>{row.data.name}</strong>
                      <small>{row.data.studentId}</small>
                    </td>
                    <td>
                      {row.data.email}
                      <small>{row.data.phone}</small>
                    </td>
                    <td>
                      {row.data.collegeName}
                      <small>
                        {row.data.branchName} · {row.data.branchCode}
                      </small>
                    </td>
                    <td>{row.data.cohort || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!!results.length && (
        <div className="registration-result" role="status">
          <strong>
            {results.some((row) => row.status === "approved") ? `${results.filter((row) => row.status === "approved").length} accounts created. Welcome emails are queued.` : "No new accounts were created."}
          </strong>
          <p>
            {results.filter((row) => row.status === "duplicate").length}{" "}
            duplicates ·{" "}
            {results.filter((row) => row.status === "invalid").length} invalid
            rows · {results.filter((row) => row.status === "failed").length} failed
            {progress < preview.length
              ? ` · ${preview.length - progress} rows not processed. Re-upload the file to retry; existing accounts will be skipped.`
              : ". Review approved records below for email status. Existing accounts are not emailed again."}
          </p>
          {results.some((row) => row.status !== "approved") && (
            <details>
              <summary>Review import outcomes</summary>
              <ul>
                {results
                  .filter((row) => row.status !== "approved")
                  .map((row) => (
                    <li key={row.row}>
                      Row {row.row}: {row.message || row.status}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

export function Registrations() {
  const [params, setParams] = useSearchParams();
  const showAdd = params.get("create") === "student";
  const requestedOrganizationId = params.get("organizationId") || "";
  const organizations = useData<Organization[]>(
      "organizations",
      "platform/organizations",
    ),
    client = useQueryClient();
  const [organizationId, setOrganizationId] = useState(requestedOrganizationId),
    [status, setStatus] = useState<ReviewStatus>(() => (["pending", "approved", "rejected", "all"] as string[]).includes(params.get("status") || "") ? params.get("status") as ReviewStatus : "pending"),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1);
  const selectionInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [showImport, setShowImport] = useState(false),
    [adding, setAdding] = useState(false),
    [importing, setImporting] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState(""),
    [issues, setIssues] = useState<string[]>([]);
  const [rejectId, setRejectId] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const lock = useRef(false);
  const query = useData<RequestRow[]>(
    `registrations-${organizationId}-${status}`,
    `platform/registrations?status=${status}${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ""}`,
  );
  const rows = useMemo(
    () =>
      (query.data || []).filter((row) =>
        `${row.name} ${row.email} ${row.studentId} ${row.branchName} ${row.branchCode} ${row.cohort || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [query.data, search],
  );
  const pending = rows.filter((row) => row.status === "pending"),
    chosen = pending.filter((row) => selected.includes(row.id));
  const pageCount = Math.max(1, Math.ceil(rows.length / reviewPageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = rows.slice((currentPage - 1) * reviewPageSize, currentPage * reviewPageSize);
  const visiblePending = visibleRows.filter((row) => row.status === "pending");
  const visibleChosen = visiblePending.filter((row) => selected.includes(row.id));
  const canSelect = status === "pending" || status === "all";
  useEffect(() => {
    setSelected([]);
    setRejectId(null);
    setPage(1);
  }, [organizationId, status, search]);
  useEffect(() => {
    if (selectionInput.current) selectionInput.current.indeterminate = visibleChosen.length > 0 && visibleChosen.length < visiblePending.length;
  }, [visibleChosen.length, visiblePending.length]);
  function selectVisible(checked: boolean) {
    const ids = visiblePending.map((row) => row.id);
    setSelected((current) => checked ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)));
  }
  function refresh() {
    refreshStudentData(client, organizationId || undefined);
  }
  function toggleAdd(open: boolean, nextOrganizationId = organizationId) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (open) next.set("create", "student");
      else next.delete("create");
      if (nextOrganizationId) next.set("organizationId", nextOrganizationId);
      else next.delete("organizationId");
      return next;
    }, { replace: true });
  }
  async function approve(ids: string[]) {
    if (lock.current || !ids.length) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setIssues([]);
    setNotice("Preparing approvals…");
    let approved = 0;
    const failures: string[] = [];
    try {
      for (let start = 0; start < ids.length; start += 25) {
        const response = await api<{
          results: { id: string; status: string; message?: string }[];
        }>("platform/registrations/approve", "POST", {
          ids: ids.slice(start, start + 25),
        });
        response.results.forEach((result) => {
          if (["approved", "already_approved"].includes(result.status))
            approved++;
          else
            failures.push(
              `${rows.find((row) => row.id === result.id)?.name || "Request"}: ${result.message || result.status}`,
            );
        });
        setNotice(
          `Reviewed ${Math.min(start + 25, ids.length)} of ${ids.length} requests. ${approved} approved.`,
        );
      }
      setNotice(
        approved
          ? `${approved} ${approved === 1 ? "request" : "requests"} approved. Welcome emails are queued. Open Created accounts to track email status, then assign learning access in People.`
          : "No requests were approved. Review the issues below and retry.",
      );
      setSelected([]);
    } catch (cause) {
      setError(cause);
      setNotice(
        `${approved} approvals completed before the interruption. Refresh and retry remaining requests.`,
      );
    } finally {
      setIssues(failures);
      refresh();
      lock.current = false;
      setBusy(false);
    }
  }
  async function reviewAction(path: string, body: object, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    setIssues([]);
    try {
      await api(path, "POST", body);
      setNotice(success);
      setRejectId(null);
      setReason("");
      refresh();
    } catch (cause) {
      setError(cause);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <AdminPage
      className="registrations-page"
      title="Student registrations"
      description="Review public registrations, create student accounts and track welcome emails."
      action={
        <div className="actions"><button type="button" className="btn primary" aria-expanded={showAdd} disabled={adding || importing || busy} onClick={() => toggleAdd(!showAdd)}>
          {showAdd ? "Close student form" : "Add student +"}
        </button><button
          type="button"
          className="btn"
          aria-expanded={showImport}
          disabled={adding || importing || busy}
          onClick={() => setShowImport(!showImport)}
      >
            {showImport ? "Close import" : "Import students +"}
          </button></div>
        }
      >
      <section className="registration-flow" aria-label="Registration process">
        <div>
          <span>01</span>
          <strong>Public registrations</strong>
          <small>Students apply and await Platform Admin approval</small>
        </div>
        <div>
          <span>02</span>
          <strong>Admin-created accounts</strong>
          <small>Single entries and confirmed imports are approved immediately</small>
        </div>
        <div>
          <span>03</span>
          <strong>Send a welcome</strong>
          <small>Temporary passwords go by email</small>
        </div>
      </section>
      {showAdd && <DataState pending={organizations.isPending} error={organizations.error}>
        <AddStudent key={requestedOrganizationId} organizations={organizations.data || []} initialOrganizationId={requestedOrganizationId}
          onPending={setAdding} onCancel={() => toggleAdd(false)} onComplete={(targetOrganizationId, name) => {
            setOrganizationId(targetOrganizationId);
            setStatus("approved");
            setSearch("");
            setSelected([]);
            setError(null);
            setIssues([]);
            setNotice(`${name}’s student account was created. The welcome email with a temporary password is queued; no further approval is required.`);
            setAdding(false);
            toggleAdd(false, targetOrganizationId);
          }} />
      </DataState>}
      {showImport && (
        <DataState
          pending={organizations.isPending}
          error={organizations.error}
        >
          <BulkImport
            organizations={organizations.data || []}
            onPending={setImporting}
            onComplete={(targetOrganizationId) => {
              setOrganizationId(targetOrganizationId);
              setStatus("approved");
              setSearch("");
              setSelected([]);
              refreshStudentData(client, targetOrganizationId);
            }}
          />
        </DataState>
      )}
      <Panel
        title="Registrations & account history"
        action={
          <div className="registration-history-tools">
            <div className="admin-header-select">
              <Field label="Filter organization">
                <AdminSelect
                  aria-label="Filter organization"
                  disabled={busy}
                  value={organizationId}
                  onChange={setOrganizationId}
                  searchable
                  options={[{ value: "", label: "All organizations" }, ...(organizations.data || []).map(org => ({ value: org.id, label: org.name }))]}
                />
              </Field>
            </div>
            <button
              className="btn"
              disabled={busy || query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        }
      >
        <div className="registration-history-filters">
          <div className="registration-status-filters" role="group" aria-label="Filter registration status">
            {reviewFilters.map((filter) => <button key={filter.value} type="button"
              className={status === filter.value ? "is-active" : ""}
              aria-pressed={status === filter.value} disabled={busy}
              onClick={() => setStatus(filter.value)}>{filter.label}</button>)}
          </div>
          <div className="registration-filters">
            <Field label="Search students">
              <input
                type="search"
                disabled={busy}
                placeholder="Name, email, student ID or branch"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
          </div>
        </div>
        <ErrorMessage error={organizations.error || error} />
        {notice && (
          <p className="registration-result" role="status">
            {notice}
          </p>
        )}
        {!!issues.length && (
          <div className="registration-issues" role="alert">
            <strong>Some requests need attention</strong>
            <ul>
              {issues.map((issue, index) => (
                <li key={index}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="registration-queue-actions">
          <span className="muted" aria-live="polite">
            {query.isPending ? "Loading records…" : `${rows.length} ${rows.length === 1 ? "record" : "records"}${search.trim() ? " matching your search" : ""}`}
          </span>
          {search && <button type="button" className="registration-clear-button" disabled={busy} onClick={() => setSearch("")}>Clear search</button>}
        </div>
        {chosen.length > 0 && <div className="registration-selection-bar" role="region" aria-label="Selected registration actions">
          <div><strong>{chosen.length} {chosen.length === 1 ? "request" : "requests"} selected</strong>
            <small>Approval creates accounts and queues welcome emails.</small></div>
          <div className="actions">
            {chosen.length < pending.length && <button type="button" className="registration-clear-button" disabled={busy} onClick={() => setSelected(pending.map((row) => row.id))}>Select all {pending.length} pending</button>}
            <button type="button" className="btn" disabled={busy} onClick={() => setSelected([])}>Clear</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => approve(chosen.map((row) => row.id))}>
              {busy ? "Working…" : `Approve ${chosen.length} & send emails`}
            </button>
          </div>
        </div>}
        <p className="registration-help">
          {status === "pending" ? <>Only public registrations and previously queued imports need review. Admin-created students are approved immediately. </> : status === "rejected" ? <>Rejected requests do not create accounts. Review the recorded reason in each row. </> : <>Track created accounts and welcome emails here. Failed emails can be retried from the row. </>}
          Assign courses and practice in{" "}
          <Link to={`/members${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`}>People & learning access</Link>.
          {(status === "approved" || status === "all") && <> “Accepted by provider” does not confirm inbox delivery.</>}
        </p>
        <DataState pending={query.isPending} error={query.error}>
          {rows.length ? (
            <>
            <div className="table-wrap">
              <table className="registration-table">
                <thead>
                  <tr>
                    {canSelect && <th className="registration-selection-heading"><input ref={selectionInput} type="checkbox" aria-label="Select pending requests on this page"
                      disabled={busy || !visiblePending.length}
                      checked={visiblePending.length > 0 && visibleChosen.length === visiblePending.length}
                      onChange={(event) => selectVisible(event.target.checked)} /></th>}
                    <th>Student</th>
                    <th>College & branch</th>
                    <th>Submitted</th>
                    <th>Status & welcome email</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.id} className={selected.includes(row.id) ? "is-selected" : undefined}>
                      {canSelect && <td>
                        {row.status === "pending" && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name}`}
                            disabled={busy}
                            checked={selected.includes(row.id)}
                            onChange={(event) =>
                              setSelected((current) =>
                                event.target.checked
                                  ? [...current, row.id]
                                  : current.filter((id) => id !== row.id),
                              )
                            }
                          />
                        )}
                      </td>}
                      <td>
                        <strong>{row.name}</strong>
                        <small>{row.studentId}</small>
                        <a href={`mailto:${row.email}`}>{row.email}</a>
                        <small>{row.phone}</small>
                      </td>
                      <td>
                        <strong>{row.organizationName}</strong>
                        <small>
                          {row.branchName} · {row.branchCode}
                        </small>
                        <small>{row.cohort || "No cohort specified"}</small>
                      </td>
                      <td>
                        {new Date(row.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        <small>
                          {row.source === "import"
                            ? row.status === "approved" ? "Admin-created account" : "Earlier admin entry / import"
                            : "Self-registration"}
                        </small>
                      </td>
                      <td>
                        <span className={`registration-status ${row.status}`}>
                          {row.status === "pending"
                            ? "Pending approval"
                            : row.status === "approved"
                              ? "Approved"
                              : "Rejected"}
                        </span>
                        {row.emailStatus && (
                          <small
                            className={
                              row.emailStatus === "failed" ||
                              row.emailStatus === "expired"
                                ? "registration-error"
                                : ""
                            }
                          >
                            {emailLabels[row.emailStatus] || row.emailStatus}
                          </small>
                        )}
                        {row.rejectionReason && (
                          <small className="registration-reason">
                            {row.rejectionReason}
                          </small>
                        )}
                        {row.emailStatus === "expired" && (
                          <small>Student can request a password reset.</small>
                        )}
                      </td>
                      <td>
                        {row.status === "pending" ? (
                          rejectId === row.id ? (
                            <form
                              className="registration-reject"
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (reason.trim())
                                  void reviewAction(
                                    `platform/registrations/${row.id}/reject`,
                                    { reason: reason.trim() },
                                    `${row.name}’s request was rejected.`,
                                  );
                              }}
                            >
                              <label>
                                Reason for rejection
                                <textarea
                                  required
                                  maxLength={1000}
                                  value={reason}
                                  disabled={busy}
                                  onChange={(event) =>
                                    setReason(event.target.value)
                                  }
                                  autoFocus
                                />
                              </label>
                              <div className="actions">
                                <button
                                  className="btn"
                                  disabled={busy || !reason.trim()}
                                >
                                  Reject request
                                </button>
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={busy}
                                  onClick={() => setRejectId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="registration-row-actions">
                              <button
                                className="btn"
                                disabled={busy}
                                onClick={() => approve([row.id])}
                              >
                                Approve
                              </button>
                              <button
                                className="registration-text-button"
                                disabled={busy}
                                onClick={() => {
                                  setRejectId(row.id);
                                  setReason("");
                                }}
                              >
                                Reject
                              </button>
                            </div>
                          )
                        ) : row.emailStatus === "failed" ? (
                          <button
                            className="btn"
                            disabled={busy}
                            onClick={() =>
                              reviewAction(
                                `platform/registrations/${row.id}/retry-email`,
                                {},
                                `Welcome email for ${row.name} was queued again.`,
                              )
                            }
                          >
                            Retry email
                          </button>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="registration-pagination" aria-label="Registration pagination">
              <span className="muted">Showing {(currentPage - 1) * reviewPageSize + 1}–{Math.min(currentPage * reviewPageSize, rows.length)} of {rows.length}</span>
              {pageCount > 1 && <div className="actions">
                <button type="button" className="btn" disabled={busy || currentPage === 1} onClick={() => { setPage(currentPage - 1); setRejectId(null); }}>Previous</button>
                <span>Page {currentPage} of {pageCount}</span>
                <button type="button" className="btn" disabled={busy || currentPage === pageCount} onClick={() => { setPage(currentPage + 1); setRejectId(null); }}>Next</button>
              </div>}
            </div>
            </>
          ) : (
            <Empty
              action={search ? <button type="button" className="btn" onClick={() => setSearch("")}>Clear search</button> : status === "pending" ? <button type="button" className="btn" onClick={() => setStatus("approved")}>View created accounts</button> : <button type="button" className="btn" onClick={() => { setStatus("all"); setOrganizationId(""); }}>View all records</button>}
              title={
                search
                  ? "No matching students"
                  : status === "pending"
                    ? "All caught up"
                    : "No requests to show"
              }
            >
              {search
                ? "Try another name, email, student ID or branch."
                : status === "pending"
                  ? "Public student registrations appear here for approval. Admin-created accounts are already in the approved list."
                  : "Choose another status or organization to see more requests."}
            </Empty>
          )}
        </DataState>
        {(query.data?.length || 0) >= 2000 && (
          <p className="note">
            Showing the latest 2,000 requests. Filter by organization and review
            status to narrow the list.
          </p>
        )}
      </Panel>
    </AdminPage>
  );
}
