import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AnnouncementAudience, AnnouncementPage, Organization, OrganizationAnnouncement, PublishAnnouncement } from "@slate/contracts";
import { api, DataState, Empty, ErrorMessage, Field, Icon, LessonContent, Panel, RichTextEditor, useData } from "@slate/ui";
import { AdminPage } from "./page";
import { AdminSelect } from "./select";
import { AdminPagination } from "./shell";
import "./announcements.css";

type Draft = { title: string; body: string };
const emptyDraft: Draft = { title: "", body: "" };
const maxBodyLength = 10_000;

function AudienceIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10v5h4l10 4V6L8 10H4ZM8 15l2 6h3l-2-5M21 9v7" /></svg>;
}

export function Announcements() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const organizations = useData<Organization[]>("organizations", "platform/organizations");
  const requestedId = searchParams.get("organizationId");
  const selectedId = organizations.data?.some(item => item.id === requestedId)
    ? requestedId!
    : organizations.data?.find(item => item.status === "active")?.id ?? organizations.data?.[0]?.id ?? "";
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [branch, setBranch] = useState({ organizationId: "", code: "" });
  const [status, setStatus] = useState<"published" | "archived">("published");
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [validation, setValidation] = useState("");
  const attempt = useRef<{ signature: string; clientId: string } | null>(null);
  const draft = drafts[selectedId] ?? emptyDraft;
  const branchCode = branch.organizationId === selectedId ? branch.code : "";
  const audience = useData<AnnouncementAudience>(
    `announcement-audience:${selectedId}`,
    `platform/announcements/audience?organizationId=${encodeURIComponent(selectedId)}`,
    Boolean(selectedId),
  );
  const target = audience.data?.organizationId === selectedId ? audience.data : undefined;
  const targetBranch = target?.branches.find(item => item.code === branchCode);
  const memberCount = branchCode ? targetBranch?.studentCount : target?.studentCount;
  const validAudience = Boolean(target && target.status === "active" && (!branchCode || targetBranch));
  const entries = useData<AnnouncementPage>(
    `announcements:${selectedId}:${status}:${page}`,
    `platform/announcements?organizationId=${encodeURIComponent(selectedId)}&status=${status}&page=${page}`,
    Boolean(selectedId),
  );
  const dirty = Object.values(drafts).some(item => item.title.trim() || item.body.trim());
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    setBranch({ organizationId: selectedId, code: "" });
    setPage(1);
    setValidation("");
    setPreview(false);
  }, [selectedId]);
  useEffect(() => {
    if (entries.data && page > 1 && !entries.data.items.length) {
      setPage(Math.max(1, Math.ceil(entries.data.total / entries.data.pageSize)));
    }
  }, [entries.data, page]);

  const refresh = (organizationId: string) => queryClient.invalidateQueries({
    predicate: query => query.queryKey[0] === "platform" && typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith(`announcements:${organizationId}:`),
  });
  const publish = useMutation({
    mutationFn: (input: PublishAnnouncement) => api<OrganizationAnnouncement>("platform/announcements", "POST", input),
    onSuccess: async (announcement) => {
      setDrafts(current => ({ ...current, [announcement.organizationId]: emptyDraft }));
      attempt.current = null;
      setPreview(false);
      setStatus("published");
      setPage(1);
      setNotice(`“${announcement.title}” published to ${announcement.branchName ? `${announcement.branchName} · ` : "all branches of "}${announcement.organizationName}.`);
      await refresh(announcement.organizationId);
    },
  });
  const update = useMutation({
    mutationFn: ({ id, status: nextStatus }: { id: string; status: "published" | "archived" }) =>
      api<OrganizationAnnouncement>(`platform/announcements/${id}`, "PATCH", { status: nextStatus }),
    onSuccess: async (announcement) => {
      setNotice(`“${announcement.title}” ${announcement.status === "archived" ? "archived. It is no longer visible to students." : "restored to its original audience."}`);
      await refresh(announcement.organizationId);
    },
  });
  const busy = publish.isPending;
  const changeDraft = (change: Partial<Draft>) => {
    setDrafts(current => ({ ...current, [selectedId]: { ...(current[selectedId] ?? emptyDraft), ...change } }));
    setValidation("");
    publish.reset();
  };
  const selectOrganization = (id: string) => {
    if (busy || id === selectedId) return;
    setSearchParams(current => { const next = new URLSearchParams(current); next.set("organizationId", id); return next; }, { replace: true });
    publish.reset();
    update.reset();
    setNotice("");
  };
  const submit = () => {
    if (busy) return;
    if (!validAudience) { setValidation("Choose an active organization and an available branch."); return; }
    if (!draft.title.trim()) { setValidation("Add a title for your announcement."); return; }
    if (!draft.body.trim()) { setValidation("Add a message for your announcement."); return; }
    if (draft.body.length > maxBodyLength) { setValidation("Shorten the message to 10,000 characters before publishing."); return; }
    setNotice("");
    setValidation("");
    const input = { organizationId: selectedId, branchCode: branchCode || null, title: draft.title.trim(), body: draft.body.trim(), format: "markdown" as const };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature) attempt.current = { signature, clientId: crypto.randomUUID() };
    publish.mutate({ ...input, clientId: attempt.current.clientId });
  };
  return <AdminPage className="admin-announcements" title="Announcements" description="Keep an entire organization or a specific branch informed with one announcement."
    action={<div className="admin-header-select"><Field label="Organization"><AdminSelect aria-label="Organization" value={selectedId} onChange={selectOrganization} searchable
      disabled={organizations.isPending || !organizations.data?.length || busy || update.isPending}
      placeholder={organizations.isPending ? "Loading organizations…" : "Select an organization"}
      options={(organizations.data ?? []).map(item => ({ value: item.id, label: `${item.name}${item.status === "archived" ? " (Archived)" : ""}` }))} /></Field></div>}>
    <DataState pending={organizations.isPending} error={organizations.error}>
      {!selectedId ? <Empty title="Choose your first audience" action={<Link className="btn primary" to="/organizations">Create an organization</Link>}>Create an organization before sharing announcements with its students.</Empty> : <>
        {notice && <p className="success-note" role="status">{notice}</p>}
        <div className="announcement-layout">
          <Panel title="Create an announcement" action={<span className="announcement-draft-label">New announcement</span>}>
            <DataState pending={audience.isPending} error={audience.error}>
              {target && <form onSubmit={event => { event.preventDefault(); submit(); }}>
                {target.status === "archived" && <p className="note announcement-archived-note">This organization is archived. Restore it before publishing or restoring announcements. <Link to="/organizations">Manage organizations →</Link></p>}
                <fieldset disabled={busy || target.status === "archived"}>
                  <div className="announcement-audience">
                    <div className="announcement-audience-heading"><AudienceIcon /><div><span className="eyebrow">AUDIENCE</span><strong>{target.organizationName}</strong></div></div>
                    <Field label="Branch"><AdminSelect aria-label="Announcement branch" value={branchCode} onChange={code => { setBranch({ organizationId: selectedId, code }); publish.reset(); setValidation(""); }}
                      disabled={busy || target.status === "archived"} searchable options={[{ value: "", label: "All branches · Entire organization" }, ...target.branches.map(item => ({ value: item.code, label: `${item.name} (${item.code})` }))]} /></Field>
                    <p className="announcement-audience-count"><Icon name="users" /><strong>{memberCount ?? 0}</strong> active student{memberCount === 1 ? "" : "s"} {branchCode ? "in this branch" : "across the organization"}</p>
                    <p className="announcement-audience-help">{branchCode ? "Only students in this branch can see this announcement." : "Includes students from every branch, including those without a branch."} Students need Announcements access to read it in their portal.</p>
                  </div>
                  <Field label="Announcement title"><input required maxLength={150} value={draft.title} onChange={event => changeDraft({ title: event.target.value })} placeholder="e.g. Campus placement orientation" /></Field>
                  <div className="announcement-editor">
                    <RichTextEditor key={selectedId} label="Announcement message" maxLength={maxBodyLength} value={draft.body} format="markdown" disabled={busy || target.status === "archived"} onChange={body => changeDraft({ body })} />
                  </div>
                  <ErrorMessage error={validation ? new Error(validation) : publish.error} />
                  <div className="announcement-compose-actions"><button className="btn" type="button" onClick={() => setPreview(!preview)} aria-expanded={preview} aria-controls="announcement-preview" disabled={busy}>{preview ? "Hide preview" : "Preview announcement"}</button>
                    <button className="btn primary" type="submit" disabled={busy || !validAudience || !draft.title.trim() || !draft.body.trim() || draft.body.length > maxBodyLength}><AudienceIcon />{busy ? "Publishing…" : "Publish announcement"}</button></div>
                  <p className="announcement-publish-help">Published immediately in the student portal. This does not send an email.</p>
                </fieldset>
                {preview && <section id="announcement-preview" className="announcement-preview" aria-label="Student announcement preview"><span className="eyebrow">STUDENT PREVIEW</span><p className="announcement-preview-audience">{targetBranch?.name ?? "Entire organization"} · {target.organizationName}</p><h3>{draft.title.trim() || "Announcement title"}</h3>{draft.body.trim() ? <LessonContent body={draft.body} format="markdown" /> : <p>Your message will appear here.</p>}</section>}
              </form>}
            </DataState>
            {audience.error && <button className="btn" type="button" onClick={() => void audience.refetch()}>Retry loading audience</button>}
          </Panel>
          <Panel title="Announcement history" action={entries.data ? <span className="admin-count">{entries.data.total} {status}</span> : undefined}>
            <div className="announcement-history-filter" role="group" aria-label="Announcement status">
              {(["published", "archived"] as const).map(value => <button type="button" key={value} className="btn" aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); update.reset(); }} disabled={update.isPending}>{value === "published" ? "Published" : "Archived"}</button>)}
            </div>
            <ErrorMessage error={update.error} />
            <DataState pending={entries.isPending} error={entries.error}>
              {entries.data?.items.length ? <>
                <div className="announcement-history-list">{entries.data.items.map(item => <article key={item.id} className={`announcement-card ${item.status === "archived" ? "is-archived" : ""}`}>
                  <div className="announcement-card-meta"><span className="announcement-scope">{item.branchName ? `${item.branchName} (${item.branchCode})` : "Entire organization"}</span><time dateTime={item.date}>{new Date(item.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</time></div>
                  <h3>{item.title}</h3>
                  <p className="announcement-author">By {item.from}</p>
                  <details><summary>Read announcement</summary><LessonContent body={item.body} format={item.format} /></details>
                  <div className="announcement-card-footer"><span>{item.status === "archived" ? "Hidden from students" : "Visible to assigned audience"}</span><button className={`btn ${item.status === "published" ? "announcement-archive" : ""}`} type="button" aria-label={`${item.status === "published" ? "Archive" : "Restore"} ${item.title}`} disabled={update.isPending || (item.status === "archived" && target?.status !== "active")} onClick={() => { setNotice(""); update.mutate({ id: item.id, status: item.status === "published" ? "archived" : "published" }); }}>{update.isPending && update.variables?.id === item.id ? "Updating…" : item.status === "published" ? "Archive" : "Restore"}</button></div>
                </article>)}</div>
                <AdminPagination page={entries.data.page} total={entries.data.total} size={entries.data.pageSize} onChange={setPage} />
              </> : <Empty title={status === "published" ? "No announcements yet" : "No archived announcements"}>{status === "published" ? "Publish an update for this organization or one of its branches. It will appear here and in the student portal." : "Archived announcements remain here and can be restored to their original audience."}</Empty>}
            </DataState>
            {entries.error && <button type="button" className="btn" onClick={() => void entries.refetch()}>Retry loading announcements</button>}
          </Panel>
        </div>
      </>}
    </DataState>
  </AdminPage>;
}
