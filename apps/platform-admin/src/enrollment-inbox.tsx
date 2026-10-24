import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CourseEnrollmentInbox, CourseEnrollmentRequest, Organization } from "@slate/contracts";
import { api, DataState, Empty, ErrorMessage, Field, Icon, useData } from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import { AdminPagination } from "./shell";
import "./enrollment-inbox.css";

const dateLabel = (value: string) => new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const emailLabels: Record<string, string> = { pending: "Email queued", processing: "Sending email", accepted: "Email accepted by provider", failed: "Email could not be sent", expired: "Email expired" };
const isInboxQuery = (key: readonly unknown[]) => typeof key[1] === "string" && key[1].startsWith("enrollment-inbox");

export function EnrollmentInbox() {
  const client = useQueryClient();
  const organizations = useData<Organization[]>("organizations", "platform/organizations");
  const [organizationId, setOrganizationId] = useState("");
  const [status, setStatus] = useState<"all" | "unread" | "pending" | "reviewed">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<CourseEnrollmentRequest | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { if (search.trim() === query) return; const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); setSelection(null); }, 250); return () => clearTimeout(timer); }, [search, query]);
  const params = new URLSearchParams({ page: String(page), pageSize: "12" });
  if (organizationId) params.set("organizationId", organizationId);
  if (status === "unread") params.set("unread", "1");
  else if (status !== "all") params.set("status", status);
  if (query) params.set("q", query);
  const entries = useData<CourseEnrollmentInbox>(`enrollment-inbox:${params}`, `platform/enrollment-requests?${params}`);
  const items = entries.data?.items ?? [];
  const selected = items.find(item => item.id === selection?.id) ?? selection;
  useEffect(() => {
    if (entries.data && page > 1 && !entries.data.items.length) setPage(Math.max(1, Math.ceil(entries.data.total / entries.data.pageSize)));
  }, [entries.data, page]);
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string; read?: boolean; status?: "pending" | "reviewed" }) => api<CourseEnrollmentRequest>(`platform/enrollment-requests/${id}`, "PATCH", body),
    onSuccess: async (result, input) => {
      client.setQueriesData<CourseEnrollmentInbox>({ predicate: entry => isInboxQuery(entry.queryKey) }, previous => previous ? { ...previous, items: previous.items.map(item => item.id === result.id ? result : item) } : previous);
      setSelection(current => current?.id === result.id ? result : current);
      if (input.status) setNotice(input.status === "reviewed" ? "Request marked as reviewed. Learning access is managed separately." : "Request moved back to pending review.");
      await client.invalidateQueries({ predicate: entry => isInboxQuery(entry.queryKey) });
    },
  });
  const choose = (request: CourseEnrollmentRequest) => {
    setSelection(request); setNotice(""); update.reset();
    if (!request.readAt && !update.isPending) update.mutate({ id: request.id, read: true });
  };
  const setFilter = (value: typeof status) => { setStatus(value); setPage(1); setSelection(null); update.reset(); };
  return <AdminPage className="admin-enrollment-inbox" title="Inbox" description="Course enrollment requests from your students, ready for your review."
    action={<div className="admin-header-select"><Field label="Organization"><AdminSelect aria-label="Inbox organization" searchable value={organizationId} onChange={value => { setOrganizationId(value); setPage(1); setSelection(null); }}
      options={[{ value: "", label: "All organizations" }, ...(organizations.data ?? []).map(item => ({ value: item.id, label: item.name }))]} /></Field></div>}>
    {notice && <p className="success-note" role="status">{notice}</p>}
    <ErrorMessage error={update.error || organizations.error} />
    <section className="enrollment-mailbox" aria-label="Enrollment requests">
      <header className="enrollment-mailbox-toolbar">
        <div className="enrollment-folder-tabs" role="group" aria-label="Filter enrollment requests">
          {(["all", "unread", "pending", "reviewed"] as const).map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => setFilter(value)}>
            {value === "all" ? "All requests" : value === "unread" ? "Unread" : value === "pending" ? "Pending review" : "Reviewed"}
            {value === "unread" && Boolean(entries.data?.unreadCount) && <span>{entries.data?.unreadCount}</span>}
          </button>)}
        </div>
        <label className="enrollment-search"><Icon name="search" /><input type="search" aria-label="Search enrollment requests" placeholder="Search student or course…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      </header>
      <DataState pending={entries.isPending} error={entries.error}>
        {items.length || selected ? <div className="enrollment-mailbox-body">
          <div className="enrollment-request-list" aria-label="Request list">
            <div className="enrollment-list-count">{entries.data?.total} request{entries.data?.total === 1 ? "" : "s"}</div>
            {items.map(item => <button key={item.id} type="button" className={`enrollment-request-item${item.readAt ? "" : " is-unread"}${selected?.id === item.id ? " is-selected" : ""}`} aria-pressed={selected?.id === item.id} disabled={update.isPending} onClick={() => choose(item)}>
              <span className="enrollment-request-from"><strong>{item.studentName}</strong>{!item.readAt && <span className="enrollment-unread-dot" aria-label="Unread" />}</span>
              <span className="enrollment-request-subject">{item.courseTitle}</span>
              <span className="enrollment-request-organization">{item.organizationName}{item.branchCode ? ` · ${item.branchCode}` : ""}</span>
              <span className="enrollment-request-meta"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time><span>{item.status === "reviewed" ? "Reviewed" : "Pending review"}</span></span>
            </button>)}
            {!items.length && <p className="enrollment-list-empty">No more requests in this view.</p>}
          </div>
          <div className="enrollment-request-detail" aria-live="polite">
            {selected ? <article aria-label={`Enrollment request from ${selected.studentName}`}>
              <header><span className="eyebrow">COURSE ENROLLMENT REQUEST</span><h2>{selected.courseTitle}</h2><div className="enrollment-detail-status"><span className={`badge ${selected.status === "reviewed" ? "green" : "amber"}`}>{selected.status === "reviewed" ? "Reviewed" : "Pending review"}</span>{selected.enrolled && <span className="badge green">Currently enrolled</span>}</div></header>
              <div className="enrollment-sender"><span className="avatar">{selected.studentName.split(" ").map(part => part[0]).slice(0, 2).join("")}</span><div><strong>{selected.studentName}</strong><a href={`mailto:${selected.studentEmail}`}>{selected.studentEmail}</a></div></div>
              <p className="enrollment-request-message"><strong>{selected.studentName}</strong> would like to enroll in <strong>{selected.courseTitle}</strong>. Review their details and update their learning access when ready.</p>
              <dl className="enrollment-student-details"><div><dt>Organization</dt><dd>{selected.organizationName}</dd></div><div><dt>Branch</dt><dd>{selected.branchName ? `${selected.branchName}${selected.branchCode ? ` (${selected.branchCode})` : ""}` : selected.branchCode || "Not provided"}</dd></div><div><dt>Student ID</dt><dd>{selected.studentId || "Not provided"}</dd></div><div><dt>Requested</dt><dd><time dateTime={selected.createdAt}>{dateLabel(selected.createdAt)}</time></dd></div></dl>
              <div className={`enrollment-email-status${selected.emailStatus === "failed" || selected.emailStatus === "expired" ? " has-error" : ""}`}><Icon name="mail" /><div><strong>{emailLabels[selected.emailStatus] || "Email notification"}</strong><span>This request remains in your inbox even if its email notification could not be sent.</span></div></div>
              <div className="enrollment-detail-actions"><Link className="btn primary" to={`/access?organizationId=${encodeURIComponent(selected.organizationId)}&studentId=${encodeURIComponent(selected.studentMemberId)}`}>Manage student access <span aria-hidden="true">→</span></Link><button type="button" className="btn" disabled={update.isPending} onClick={() => update.mutate({ id: selected.id, read: true, status: selected.status === "reviewed" ? "pending" : "reviewed" })}>{update.isPending ? "Updating…" : selected.status === "reviewed" ? "Move to pending" : "Mark reviewed"}</button><Link className="enrollment-course-link" to={`/courses/${selected.courseId}`}>View course</Link></div>
              <p className="enrollment-review-help">Marking a request reviewed does not enroll the student. Assign the course from Learning access.</p>
            </article> : <Empty title="Select a request">Open a student’s request to view their details and manage course access.</Empty>}
          </div>
        </div> : <Empty title={status === "unread" ? "You’re all caught up" : query || organizationId || status !== "all" ? "No matching requests" : "No enrollment requests yet"}>{query || organizationId || status !== "all" ? "Try another filter to find requests." : "When a student requests a course from the catalog, their details will appear here."}</Empty>}
      </DataState>
      {entries.error && <button className="btn" type="button" onClick={() => void entries.refetch()}>Retry loading requests</button>}
      {entries.data && <div className="enrollment-mailbox-pagination"><AdminPagination page={entries.data.page} total={entries.data.total} size={entries.data.pageSize} onChange={next => { setPage(next); setSelection(null); }} /></div>}
    </section>
  </AdminPage>;
}
