import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import type {
  Course,
  IntegrationStatus,
  Job,
  Lesson,
  Member,
  Organization,
  AccessWorkspace,
} from "@slate/contracts";
import {
  api,
  DataState,
  Empty,
  ErrorMessage,
  Field,
  Login,
  NotFound,
  Onboarding,
  Panel,
  Protected,
  ResetPassword,
  useData,
} from "@slate/ui";
import { Exams, ExamEditor } from "./exams";
import { Announcements } from "./announcements";
import { AddStudent, Registrations } from "./registrations";
import { LearningAccess } from "./access";
import { AdminDashboard } from "./dashboard";
import { AdminPagination, AdminShell } from "./shell";
import { AdminSelect } from "./select";
import { BranchFields, selectedOrganizationBranch, useOrganizationBranches } from "./student-branches";
import { AdminPage } from "./page";
import { CourseLessonBuilder, CourseSubmissions, lessonValidation } from "./lesson-editor";

async function updateCachedList<T>(
  client: QueryClient,
  key: QueryKey,
  update: (items: T[]) => T[],
) {
  if (client.getQueryData<T[]>(key) === undefined) {
    void client.invalidateQueries({ queryKey: key, exact: true });
    return;
  }
  await client.cancelQueries({ queryKey: key, exact: true });
  client.setQueryData<T[]>(key, (items) =>
    items === undefined ? undefined : update(items),
  );
}

const navigation = [
  { to: "/", label: "Dashboard", icon: "grid" },
  { to: "/organizations", label: "Organizations", icon: "users" },
  { to: "/registrations", label: "Registrations", icon: "resume" },
  { to: "/members", label: "People", icon: "users" },
  { to: "/access", label: "Access", icon: "toolkit" },
  { to: "/courses", label: "Courses", icon: "book" },
  { to: "/exams", label: "Live exams", icon: "exam" },
  { to: "/jobs", label: "Jobs", icon: "jobs" },
  { to: "/announcements", label: "Announcements", icon: "resume" },
  { to: "/integrations", label: "Services", icon: "toolkit" },
];
function useOrganizations() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedId = searchParams.get("organizationId");
  const query = useData<Organization[]>(
      "organizations",
      "platform/organizations",
    );
  const selected = query.data?.some((org) => org.id === requestedId)
    ? requestedId!
    : query.data?.find(organization => organization.status === "active")?.id ?? query.data?.[0]?.id ?? "";
  const setSelected = (id: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("organizationId", id);
      return next;
    }, { replace: true });
  };
  return { query, selected, setSelected };
}
function OrganizationSelect({
  organizations,
  value,
  onChange,
  disabled,
}: {
  organizations: Organization[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label="Organization">
      <AdminSelect aria-label="Organization" value={value} disabled={disabled} onChange={onChange} searchable
        options={[{ value: "", label: "Select an organization" }, ...organizations.map(org => ({
          value: org.id, label: `${org.name}${org.status === "archived" ? " (Archived)" : ""}`,
        }))]} />
    </Field>
  );
}
function OrganizationCard({ organization, onUpdated }: { organization: Organization; onUpdated: (organization: Organization) => void }) {
  const client = useQueryClient();
  const actionButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const archived = organization.status === "archived";
  const action = archived ? "Restore" : "Archive";
  const confirmationId = `organization-confirm-${organization.id}`;
  const update = useMutation({
    mutationFn: (status: "active" | "archived") =>
      api<Organization>(`platform/organizations/${organization.id}`, "PATCH", { status }),
    onSuccess: async (updated) => {
      onUpdated(updated);
      await updateCachedList<Organization>(client, ["platform", "organizations"], (items) =>
        items.map((item) => item.id === updated.id ? updated : item),
      );
      const accessKey = ["platform", "access", updated.id];
      await client.cancelQueries({ queryKey: accessKey, exact: true });
      client.setQueryData<AccessWorkspace>(accessKey, (cached) => cached
        ? { ...cached, organization: { ...cached.organization, ...updated } }
        : undefined);
      void client.invalidateQueries({ queryKey: accessKey, exact: true });
      setConfirming(false);
      void client.invalidateQueries({ queryKey: ["platform", "summary"], exact: true });
      actionButton.current?.focus();
    },
  });
  useEffect(() => {
    setConfirming(false);
  }, [organization.status]);
  return (
    <article className={`card${archived ? " is-archived" : ""}`} aria-label={organization.name}>
      <span className="card-icon" aria-hidden="true">{organization.name.slice(0, 2).toUpperCase()}</span>
      <h2>{organization.name}</h2>
      <span className={`badge ${archived ? "amber" : "green"}`} style={{ alignSelf: "flex-start" }}>{archived ? "Archived" : "Active"}</span>
      <p>Created {new Date(organization.createdAt).toLocaleDateString("en-IN")}</p>
      {archived && <p className="muted">Portal access is paused. Students, progress and learning assignments are preserved.</p>}
      <div className="actions">
        {!archived && <Link className="btn primary" to={`/access?organizationId=${organization.id}`}>Customize learning →</Link>}
        <Link className="btn" to={`/members?organizationId=${organization.id}`}>{archived ? "View people →" : "Manage people →"}</Link>
        {!archived && <Link className="btn" to={`/access?organizationId=${organization.id}&tab=branches`}>Manage branches →</Link>}
        <button
          ref={actionButton}
          type="button"
          className={`btn${archived ? "" : " organization-archive"}`}
          aria-label={`${action} ${organization.name}`}
          aria-expanded={confirming}
          aria-controls={confirming ? confirmationId : undefined}
          disabled={update.isPending}
          onClick={() => {
            update.reset();
            setConfirming(!confirming);
          }}
        >{action}</button>
      </div>
      {confirming && (
        <div className="note" id={confirmationId} role="group" aria-labelledby={`${confirmationId}-title`} aria-busy={update.isPending}>
          <strong id={`${confirmationId}-title`}>{action} {organization.name}?</strong>
          <p>{archived
            ? "Restore organization access and let eligible students and organization viewers sign in again. Individual account restrictions remain in place."
            : "All students and organization viewers will lose portal access and their current sessions will end. Student records, course assignments and progress will be preserved. You can restore this organization later."}</p>
          <ErrorMessage error={update.error} />
          <div className="actions">
            <button type="button" className={`btn primary${archived ? "" : " organization-archive"}`} disabled={update.isPending} onClick={() => update.mutate(archived ? "active" : "archived")}>
              {update.isPending ? (archived ? "Restoring…" : "Archiving…") : `${action} organization`}
            </button>
            <button type="button" className="btn" disabled={update.isPending} onClick={() => {
              setConfirming(false);
              update.reset();
              actionButton.current?.focus();
            }}>Cancel</button>
          </div>
        </div>
      )}
    </article>
  );
}
function Organizations() {
  const data = useData<Organization[]>("organizations", "platform/organizations");
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const showCreate = params.get("create") === "organization";
  const setShowCreate = (open: boolean) => setParams(current => {
    const next = new URLSearchParams(current);
    if (open) next.set("create", "organization"); else next.delete("create");
    return next;
  }, { replace: true });
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const organizations = data.data ?? [];
  const visibleOrganizations = organizations.filter(organization =>
    (statusFilter === "all" || organization.status === statusFilter) && organization.name.toLowerCase().includes(search.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visibleOrganizations.length / 12)));
  const create = useMutation({
    mutationFn: () => api<Organization>("platform/organizations", "POST", { name }),
    onSuccess: async (organization) => {
      await updateCachedList<Organization>(client, ["platform", "organizations"], items => [organization, ...items.filter(item => item.id !== organization.id)]);
      setName(""); setStatusFilter("all"); setSearch(""); setPage(1); setShowCreate(false);
      setNotice(`${organization.name} has been created.`);
      void client.invalidateQueries({ queryKey: ["platform", "summary"] });
    },
  });
  return <AdminPage title="Organizations" description="Manage each organization’s people, learning access and account status." action={
      <button type="button" className="btn primary" aria-expanded={showCreate} aria-controls="organization-create" disabled={create.isPending} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Close form" : "+ New organization"}</button>
    }>
    <div id="organization-create" className="admin-create-panel" hidden={!showCreate}>
      <Panel title="Create an organization">
        <form onSubmit={event => { event.preventDefault(); create.mutate(); }}>
          <Field label="Organization name"><input required maxLength={150} placeholder="College or organization name" value={name} onChange={event => setName(event.target.value)} /></Field>
          <ErrorMessage error={create.error} />
          <div className="actions"><button className="btn primary" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create organization"}</button><button type="button" className="btn" disabled={create.isPending} onClick={() => setShowCreate(false)}>Cancel</button></div>
        </form>
      </Panel>
    </div>
    {notice && <p className="success-note" role="status">{notice}</p>}
    <Panel title="Organization directory">
      <div className="admin-filterbar">
        <div className="field admin-search-field"><label htmlFor="organization-search">Search organizations</label><input id="organization-search" type="search" placeholder="Search organization name…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
        <Field label="Organization status"><AdminSelect aria-label="Organization status" value={statusFilter} onChange={value => { setStatusFilter(value as typeof statusFilter); setPage(1); }} options={[
          { value: "all", label: `All statuses (${organizations.length})` },
          { value: "active", label: `Active (${organizations.filter(org => org.status === "active").length})` },
          { value: "archived", label: `Archived (${organizations.filter(org => org.status === "archived").length})` },
        ]} /></Field>
      </div>
      <DataState pending={data.isPending} error={data.error}>
        {visibleOrganizations.length ? <>
          <div className="admin-organizations-grid">{visibleOrganizations.slice((currentPage - 1) * 12, currentPage * 12).map(organization => <OrganizationCard key={organization.id} organization={organization} onUpdated={updated => {
            setNotice(updated.status === "archived" ? `${updated.name} is archived. Student and organization-viewer access is blocked; records are preserved.` : `${updated.name} is active again. Eligible members can sign in again; suspended and disabled accounts remain unchanged.`);
          }} />)}</div>
          <AdminPagination page={currentPage} total={visibleOrganizations.length} size={12} onChange={setPage} />
        </> : <Empty title={organizations.length ? "No matching organizations" : "Create your first organization"} action={<button className="btn" onClick={() => { if (organizations.length) { setSearch(""); setStatusFilter("all"); setPage(1); } else setShowCreate(true); }}>{organizations.length ? "Clear filters" : "New organization"}</button>}>
          {organizations.length ? "Try another name or status." : "Create an organization, then add its students and assign their learning."}
        </Empty>}
      </DataState>
    </Panel>
  </AdminPage>;
}
function StudentDetailsEditor({ member, onClose, onSaved, onPending }: {
  member: Member;
  onClose: () => void;
  onSaved: (message: string) => void;
  onPending: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [details, setDetails] = useState({ name: member.name, email: member.email, phone: member.phone || "", branchName: member.branchName || "", branchCode: member.branchCode || "" });
  const organizationId = member.organizationId || "";
  const branchQuery = useOrganizationBranches(organizationId);
  const selectedBranch = selectedOrganizationBranch(branchQuery.data, organizationId, details.branchCode);
  const branchReady = Boolean(selectedBranch) && !branchQuery.isPending && !branchQuery.error;
  const dirty = details.name.trim() !== member.name || details.email.trim().toLowerCase() !== member.email || details.phone.trim() !== (member.phone || "") || details.branchName.trim() !== (member.branchName || "") || details.branchCode.trim().toUpperCase() !== (member.branchCode || "");
  const update = useMutation({
    mutationFn: () => {
      if (!branchReady || !selectedBranch) throw new Error("Choose a branch from this organization before saving.");
      return api<Member & { welcomeEmailStatus?: string }>(`platform/organizations/${member.organizationId}/students/${member.id}`, "PATCH", {
        name: details.name.trim(), email: details.email.trim().toLowerCase(), phone: details.phone.trim(),
        branchName: selectedBranch.name, branchCode: selectedBranch.code,
      });
    },
    onSuccess: async (updated) => {
      await updateCachedList<Member>(client, ["platform", `members-${member.organizationId}`], (items) => items.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      void client.invalidateQueries({ queryKey: ["platform", "access", member.organizationId], exact: true });
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] === "platform" && typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith("registrations-") });
      onSaved(`Details saved for ${updated.name}.${updated.welcomeEmailStatus === "pending" ? " A new welcome email is queued to their updated address." : ""}`);
      onClose();
    },
  });
  useEffect(() => { onPending(update.isPending); }, [update.isPending, onPending]);
  useEffect(() => () => onPending(false), [onPending]);
  const fields: { key: keyof typeof details; label: string; max: number; type?: string }[] = [
    { key: "name", label: "Full name", max: 120 }, { key: "email", label: "Student email", max: 200, type: "email" },
    { key: "phone", label: "Phone number", max: 30, type: "tel" },
  ];
  return <form className="student-details-editor" aria-label={`Edit details for ${member.name}`} aria-busy={update.isPending} onSubmit={(event) => { event.preventDefault(); if (dirty && branchReady && !update.isPending) update.mutate(); }}>
    <strong>Edit student details</strong>
    <p className="registration-help">Changing email signs the student out. A new phone number requires verification. Changing branch can change inherited learning access. Select an existing organization branch; its code is filled automatically.</p>
    <fieldset className="registration-student-fields" disabled={update.isPending}>
      <div className="form-grid">{fields.map((field) => <Field key={field.key} label={field.label}>
        <input required type={field.type || "text"} maxLength={field.max} value={details[field.key]} onChange={(event) => setDetails((current) => ({ ...current, [field.key]: event.target.value }))} />
      </Field>)}
        <BranchFields organizationId={organizationId} branches={branchQuery.data} code={details.branchCode}
          onChange={branch => setDetails(current => ({ ...current, branchName: branch?.name || "", branchCode: branch?.code || "" }))}
          pending={branchQuery.isPending} error={branchQuery.error} disabled={update.isPending} onRetry={() => { void branchQuery.refetch(); }} />
      </div>
    </fieldset>
    <ErrorMessage error={update.error} />
    <div className="actions"><button className="btn primary" disabled={!dirty || !branchReady || update.isPending}>{update.isPending ? "Saving…" : "Save details"}</button>
      <button type="button" className="btn" disabled={update.isPending} onClick={onClose}>Cancel</button></div>
  </form>;
}
function MemberActions({ member, archived = false, onDetailsSaved }: { member: Member; archived?: boolean; onDetailsSaved?: (notice: string) => void }) {
  const query = useQueryClient();
  const [status, setStatus] = useState(member.status);
  const [editing, setEditing] = useState(false);
  const [editingPending, setEditingPending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => setStatus(member.status), [member.status]);
  const update = useMutation({
    mutationFn: () =>
      api<Pick<Member, "id" | "status" | "features">>(
        `platform/members/${member.id}`,
        "PATCH",
        { status },
      ),
    onSuccess: async (updated) => {
      await updateCachedList<Member>(
        query,
        ["platform", `members-${member.organizationId}`],
        (items) =>
          items.map((item) =>
            item.id === updated.id ? { ...item, ...updated } : item,
          ),
      );
      void query.invalidateQueries({
        queryKey: ["platform", "access", member.organizationId],
      });
    },
  });
  return <>
    <div className="actions">
      <AdminSelect aria-label={`Account status for ${member.name}`} disabled={update.isPending || editingPending} value={status} onChange={value => setStatus(value as Member["status"])}
        options={[{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "disabled", label: "Disabled" }]} />
      <button type="button" className="btn" disabled={status === member.status || update.isPending || editingPending} onClick={() => update.mutate()}>{update.isPending ? "Updating…" : "Update status"}</button>
      {member.role === "student" && <Link className="btn" to={`/access?organizationId=${member.organizationId}&studentId=${member.id}`}>Learning access →</Link>}
      {member.role === "student" && <button type="button" className="btn" aria-expanded={editing} disabled={archived || update.isPending || editingPending} title={archived ? "Restore the organization to edit student details." : undefined} onClick={() => { setEditing(!editing); setNotice(""); }}>{editing ? "Close details" : "Edit details"}</button>}
    </div>
    <ErrorMessage error={update.error} />
    {notice && <p className="success-note" role="status">{notice}</p>}
    {editing && !archived && <StudentDetailsEditor member={member} onPending={setEditingPending} onSaved={onDetailsSaved || setNotice} onClose={() => setEditing(false)} />}
  </>;
}
function Members() {
  const org = useOrganizations(),
    client = useQueryClient(),
    data = useData<Member[]>(
      `members-${org.selected}`,
      `platform/organizations/${org.selected}/members`,
      Boolean(org.selected),
    );
  const archived = org.query.data?.find((organization) => organization.id === org.selected)?.status === "archived";
  const [params, setParams] = useSearchParams();
  const showAdd = params.get("create") === "student";
  const setShowAdd = (open: boolean) => setParams(current => {
    const next = new URLSearchParams(current);
    if (open) next.set("create", "student"); else next.delete("create");
    return next;
  }, { replace: true });
  const [accountStatus, setAccountStatus] = useState("all");
  const [branch, setBranch] = useState("all");
  const [page, setPage] = useState(1);
  const roleView = params.get("role") === "organization_viewer" ? "organization_viewer" : "student";
  const setRoleView = (role: "student" | "organization_viewer") => setParams(current => {
    const next = new URLSearchParams(current);
    if (role === "student") next.delete("role"); else next.set("role", role);
    return next;
  }, { replace: true });
  const [adding, setAdding] = useState(false);
  const [studentNotice, setStudentNotice] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [search, setSearch] = useState(""),
    [credentials, setCredentials] = useState<{
      name: string;
      email: string;
      temporaryPassword: string;
    } | null>(null);
  const create = useMutation({
    mutationFn: (input: { organizationId: string; name: string; email: string }) =>
      api<{ name: string; email: string; temporaryPassword: string }>(
        "platform/members",
        "POST",
        {
          ...input,
          role: "organization_viewer",
        },
      ),
    onSuccess: (result, input) => {
      setCredentials(result);
      setName("");
      setEmail("");
      void client.invalidateQueries({
        queryKey: ["platform", `members-${input.organizationId}`],
        exact: true,
      });
      void client.invalidateQueries({ queryKey: ["platform", "summary"] });
    },
  });
  const roleMembers = (data.data || []).filter(member => member.role === roleView);
  const branches = [...new Set(roleMembers.map(member => member.branchCode).filter((code): code is string => Boolean(code)))].sort();
  const rows = roleMembers.filter(member =>
    (accountStatus === "all" || member.status === accountStatus) &&
    (branch === "all" || member.branchCode === branch) &&
    `${member.name} ${member.email} ${member.studentId || ""} ${member.branchName || ""} ${member.branchCode || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)));
  useEffect(() => { setBranch("all"); setAccountStatus("all"); setPage(1); setSearch(""); }, [org.selected, roleView]);
  return (
    <AdminPage
        title="People & learning access"
        description="Create and manage student accounts, organization viewers and their assigned learning."
        action={
          <div className="admin-header-tools">
            <div className="admin-header-select"><OrganizationSelect
              organizations={org.query.data || []}
              value={org.selected}
              disabled={adding || create.isPending || org.query.isPending}
              onChange={(value) => {
                org.setSelected(value);
                setCredentials(null);
                setStudentNotice("");
                setProfileNotice("");
                setName(""); setEmail("");
              }}
            /></div>
          </div>
        }
    >
      <DataState pending={org.query.isPending} error={org.query.error}>
        {!org.selected ? (
          <Empty
            title="Choose an organization"
            action={
              <Link className="btn" to="/organizations">
                Create an organization
              </Link>
            }
          >
            Select an organization before managing its students and viewers.
          </Empty>
        ) : (
          <>
            <div className="admin-people-toolbar">
            <div className="people-role-tabs" role="group" aria-label="Account type">
              {(["student", "organization_viewer"] as const).map((role) => <button type="button" key={role}
                className="btn" aria-pressed={roleView === role}
                disabled={adding || create.isPending} onClick={() => { setRoleView(role); setSearch(""); setCredentials(null); }}>
                {role === "student" ? "Students" : "Organization viewers"} ({data.data?.filter((member) => member.role === role).length ?? 0})
              </button>)}
            </div>
            <div className="actions">
              {roleView === "student" && <button type="button" className="btn primary" disabled={archived || adding} aria-expanded={showAdd} aria-controls="student-create" onClick={() => setShowAdd(!showAdd)}>{showAdd ? "Close form" : "+ Add student"}</button>}
              <Link className="btn" to={`/registrations?organizationId=${org.selected}`}>Review registrations →</Link>
            </div>
            </div>
            {archived && <div className="access-archived-notice" role="status">
              <div><strong>This organization is archived.</strong><p>Restore the organization before adding accounts. Existing records and individual account controls remain available below.</p></div>
              <Link className="btn" to="/organizations">Manage organizations →</Link>
            </div>}
            {roleView === "student" ? <>
              {studentNotice && <p className="success-note" role="status">{studentNotice} <Link to={`/registrations?organizationId=${org.selected}&status=approved`}>View welcome email status →</Link></p>}
              {!archived && <div className="admin-create-panel" id="student-create" hidden={!showAdd}><AddStudent key={org.selected} organizations={org.query.data || []} initialOrganizationId={org.selected} fixedOrganization onPending={setAdding}
                onComplete={(organizationId, studentName) => {
                  setShowAdd(false); setPage(1); setSearch(""); setBranch("all"); setAccountStatus("all");
                  setStudentNotice(`${studentName}’s account was created. Their welcome email with a temporary password is queued; no further approval is needed.`);
                }} /></div>}
            </> : <div className="split">
              <Panel title="Create an organization viewer">
                {archived ? <div className="note">
                  <strong>This organization is archived.</strong>
                  <p>Restore the organization before creating viewer accounts. Existing records and individual account controls remain available below.</p>
                  <Link className="btn" to="/organizations">Manage organizations →</Link>
                </div> :
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    create.mutate({ organizationId: org.selected, name, email });
                  }}
                >
                  <div className="form-grid">
                    <Field label="Full name">
                      <input
                        required
                        maxLength={150}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field label="Login email">
                      <input
                        type="email"
                        required
                        maxLength={200}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                      />
                    </Field>
                  </div>
                  <p className="note">
                    This creates an Organization Admin account for viewing analytics.
                    It does not grant student-portal access. To create student accounts,{" "}
                    <Link to={`/registrations?create=student&organizationId=${org.selected}`}>
                      add a student
                    </Link>
                    . Their account and welcome email are created immediately.
                  </p>
                  <ErrorMessage error={create.error} />
                  <button className="btn primary" disabled={create.isPending}>
                    {create.isPending ? "Creating…" : "Create viewer account"}
                  </button>
                </form>}
              </Panel>
              <Panel title="Organization viewer credentials">
                {credentials ? (
                  <div className="credentials">
                    <strong>{credentials.name}</strong>
                    <p>{credentials.email}</p>
                    <span className="muted">
                      Temporary password · shown once
                    </span>
                    <code>{credentials.temporaryPassword}</code>
                    <p className="note">For the Organization Admin portal. These credentials do not grant student access.</p>
                    <p>
                      Share securely through the organization’s existing
                      channel. The user must change this password on first
                      login.
                    </p>
                    <div className="actions">
                      <button
                        className="btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `${credentials.email}\n${credentials.temporaryPassword}`,
                          )
                        }
                      >
                        Copy credentials
                      </button>
                      <button
                        className="btn"
                        onClick={() => setCredentials(null)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    A new account’s temporary credentials appear here once.
                    Permanent passwords cannot be retrieved.
                  </p>
                )}
              </Panel>
            </div>}
            <Panel title={roleView === "student" ? "Student accounts" : "Organization viewer accounts"}>
              {profileNotice && <p className="success-note" role="status">{profileNotice}</p>}
              <div className="admin-filterbar">
                <div className="field admin-search-field"><label htmlFor="member-search">Search accounts</label><input id="member-search" type="search" placeholder={roleView === "student" ? "Search name, email, student ID or branch…" : "Search name or email…"} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
                {roleView === "student" && <Field label="Branch"><AdminSelect aria-label="Branch" value={branch} searchable onChange={value => { setBranch(value); setPage(1); }} options={[{ value: "all", label: "All branches" }, ...branches.map(code => ({ value: code, label: code }))]} /></Field>}
                <Field label="Account status"><AdminSelect aria-label="Account status" value={accountStatus} onChange={value => { setAccountStatus(value); setPage(1); }} options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "disabled", label: "Disabled" }]} /></Field>
              </div>
              <DataState pending={data.isPending} error={data.error}>
                {rows.length ? (
                  <div className="table-wrap">
                    <table className="admin-people-table">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Account setup</th>
                          <th>Status & learning access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice((currentPage - 1) * 20, currentPage * 20).map((member) => (
                          <tr key={member.id}>
                            <td>
                              <strong>{member.name}</strong>
                              <small>{member.email}</small>
                              {member.role === "student" && <><small>{member.phone || "No phone recorded"}</small><small>{member.branchName || "No branch"}{member.branchCode ? ` · ${member.branchCode}` : ""}</small></>}
                            </td>
                            <td>
                              <span className={`badge ${member.status === "active" ? "green" : "amber"}`}>{member.status}</span>
                              {member.studentId && <small>ID · {member.studentId}</small>}
                              <small>
                                {!member.passwordSetupComplete
                                  ? "Password change required"
                                  : member.role === "student" &&
                                      !member.phoneVerifiedAt
                                    ? "Phone verification required"
                                    : "Account setup complete"}
                              </small>
                            </td>
                            <td>
                              <MemberActions member={member} archived={archived} onDetailsSaved={setProfileNotice} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty title="No accounts to show" action={(search || branch !== "all" || accountStatus !== "all") ? <button className="btn" onClick={() => { setSearch(""); setBranch("all"); setAccountStatus("all"); setPage(1); }}>Clear filters</button> : undefined}>
                    {search || branch !== "all" || accountStatus !== "all" ? "Try another search, branch or account status." : roleView === "student" ? "Use Add student to create an account and send login details. Public registrations appear here after approval." : "Create an organization viewer above to give them access to organization analytics."}
                  </Empty>
                )}
                <AdminPagination page={currentPage} total={rows.length} size={20} onChange={setPage} />
              </DataState>
            </Panel>
          </>
        )}
      </DataState>
    </AdminPage>
  );
}
function CourseActions({ course, onChanged, onDeleted, disabled = false, unsaved = false, onPending }: {
  course: Course;
  onChanged: (notice: string) => void;
  onDeleted?: () => void;
  disabled?: boolean;
  unsaved?: boolean;
  onPending?: (pending: boolean) => void;
}) {
  const client = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const action = course.status === "draft" ? "Delete draft" : course.status === "archived" ? "Restore" : "Archive";
  const removing = course.status === "draft";
  const restoring = course.status === "archived";
  const update = useMutation({
    mutationFn: async (operation: "delete" | "archived" | "published") => {
      if (operation === "delete") {
        await api<{ id: string; deleted: true }>(`platform/courses/${course.id}`, "DELETE");
        return { deleted: true as const };
      }
      return { deleted: false as const, course: await api<Course>(`platform/courses/${course.id}`, "PATCH", { status: operation }) };
    },
    onSuccess: async (result, operation) => {
      await updateCachedList<Course>(client, ["platform", "courses"], (items) => operation === "delete"
        ? items.filter((item) => item.id !== course.id)
        : items.map((item) => item.id === course.id && !result.deleted ? { ...item, ...result.course } : item));
      const detailKey = ["platform", `course-${course.id}`];
      await client.cancelQueries({ queryKey: detailKey, exact: true });
      if (operation === "delete") client.removeQueries({ queryKey: detailKey, exact: true });
      else if (!result.deleted) client.setQueryData<Course & { lessons: Lesson[] }>(detailKey, (cached) => cached ? { ...cached, ...result.course } : undefined);
      void client.invalidateQueries({ queryKey: ["platform", "access"] });
      void client.invalidateQueries({ queryKey: ["platform", "summary"], exact: true });
      setConfirming(false);
      onChanged(operation === "delete" ? `${course.title} draft was deleted.` : operation === "archived"
        ? `${course.title} is archived. Existing assignments and progress are preserved; new selections are blocked.`
        : `${course.title} is restored and available for new learning selections.`);
      if (operation === "delete") onDeleted?.();
    },
  });
  useEffect(() => { onPending?.(update.isPending); }, [update.isPending, onPending]);
  useEffect(() => { setConfirming(false); update.reset(); }, [course.status]);
  return <div className="course-lifecycle">
    <button type="button" className={`btn${restoring ? "" : " danger"}`} disabled={disabled || update.isPending}
      aria-label={`${action} ${course.title}`} aria-expanded={confirming} aria-controls={confirming ? `course-confirm-${course.id}` : undefined}
      onClick={() => { setConfirming(!confirming); update.reset(); }}>{action}</button>
    {confirming && <div className="note" id={`course-confirm-${course.id}`} role="group" aria-label={`${action} ${course.title}`} aria-busy={update.isPending}>
      <strong>{action} “{course.title}”?</strong>
      <p>{removing ? "Permanently remove this unpublished draft. This cannot be undone. Published courses must be archived to preserve their learning records."
        : restoring ? "Make this course available for new learning selections again. Existing course versions and student progress stay unchanged."
          : "Remove this course from new learning selections. Existing student assignments, course versions and progress stay available. You can restore the course later."}</p>
      {unsaved && <p>Unsaved editor changes will be discarded.</p>}
      <ErrorMessage error={update.error} />
      <div className="actions">
        <button type="button" className={`btn primary${restoring ? "" : " danger"}`} disabled={disabled || update.isPending}
          onClick={() => update.mutate(removing ? "delete" : restoring ? "published" : "archived")}>{update.isPending ? "Updating…" : removing ? "Delete draft permanently" : `${action} course`}</button>
        <button type="button" className="btn" disabled={update.isPending} onClick={() => { setConfirming(false); update.reset(); }}>Cancel</button>
      </div>
    </div>}
  </div>;
}
function Courses() {
  const data = useData<Course[]>("courses", "platform/courses"), client = useQueryClient(), navigate = useNavigate();
  const [title, setTitle] = useState(""), [description, setDescription] = useState(""), [track, setTrack] = useState("foundation");
  const [statusFilter, setStatusFilter] = useState("all"), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false), [notice, setNotice] = useState("");
  const tracks: Record<string, string> = { general: "General learning", foundation: "Foundation", hiring: "Hiring assessments", crt: "CRT modules", dsa: "Advanced DSA", fullstack: "Full Stack", competitive: "Competitive coding" };
  const courses = data.data || [];
  const visibleCourses = courses.filter(course => (statusFilter === "all" || course.status === statusFilter) && `${course.title} ${course.description} ${tracks[course.track] || course.track}`.toLowerCase().includes(search.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(visibleCourses.length / 12)));
  const create = useMutation({
    mutationFn: () => api<Course>("platform/courses", "POST", { title, description, track }),
    onSuccess: async course => {
      await updateCachedList<Course>(client, ["platform", "courses"], items => [...items.filter(item => item.id !== course.id), course].sort((a, b) => a.title.localeCompare(b.title)));
      client.setQueryData(["platform", `course-${course.id}`], { ...course, lessons: [] });
      navigate(`/courses/${course.id}`);
    },
  });
  return <AdminPage title="Courses & modules" description="Create learning content, publish updates and manage your course catalog." action={
      <button type="button" className="btn primary" aria-expanded={showCreate} aria-controls="course-create" disabled={create.isPending} onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Close form" : "+ New course"}</button>
    }>
    <div id="course-create" className="admin-create-panel" hidden={!showCreate}>
      <Panel title="Create a course">
        <form onSubmit={event => { event.preventDefault(); create.mutate(); }}>
          <div className="form-grid">
            <Field label="Course title"><input required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} placeholder="e.g. Data Structures & Algorithms" /></Field>
            <Field label="Learning track"><AdminSelect aria-label="Learning track" value={track} onChange={setTrack} searchable options={Object.entries(tracks).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="Description"><textarea required maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What will students learn?" /></Field>
          <ErrorMessage error={create.error} />
          <div className="actions"><button className="btn primary" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create draft course"}</button><button type="button" className="btn" disabled={create.isPending} onClick={() => setShowCreate(false)}>Cancel</button></div>
        </form>
      </Panel>
    </div>
    {notice && <p className="success-note" role="status">{notice}</p>}
    <Panel title="Course catalog">
      <div className="admin-filterbar">
        <div className="field admin-search-field"><label htmlFor="course-search">Search courses</label><input id="course-search" type="search" placeholder="Search title, description or learning track…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
        <Field label="Course status"><AdminSelect aria-label="Course status" value={statusFilter} onChange={value => { setStatusFilter(value); setPage(1); }} options={[
          { value: "all", label: `All statuses (${courses.length})` },
          ...(["draft", "published", "archived"] as const).map(status => ({ value: status, label: `${status[0].toUpperCase() + status.slice(1)} (${courses.filter(course => course.status === status).length})` })),
        ]} /></Field>
      </div>
      <DataState pending={data.isPending} error={data.error}>
        {visibleCourses.length ? <>
          <div className="table-wrap"><table className="admin-course-table">
            <thead><tr><th>Course</th><th>Track</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{visibleCourses.slice((currentPage - 1) * 12, currentPage * 12).map(course => <tr key={course.id}>
              <td><Link className="admin-course-title" to={`/courses/${course.id}`}>{course.title}</Link><span className="admin-course-description">{course.description}</span></td>
              <td>{tracks[course.track] || course.track}</td>
              <td><span className={`badge ${course.status === "published" ? "green" : course.status === "draft" ? "amber" : ""}`}>{course.status}</span>{Boolean(course.version) && <small>Version {course.version}</small>}</td>
              <td><Link className="btn" to={`/courses/${course.id}`}>{course.status === "archived" ? "View course" : "Edit course"} →</Link><CourseActions course={course} onChanged={setNotice} /></td>
            </tr>)}</tbody>
          </table></div>
          <AdminPagination page={currentPage} total={visibleCourses.length} size={12} onChange={setPage} />
        </> : <Empty title={courses.length ? "No matching courses" : "Build your course catalog"} action={<button className="btn" onClick={() => { if (courses.length) { setSearch(""); setStatusFilter("all"); setPage(1); } else setShowCreate(true); }}>{courses.length ? "Clear filters" : "New course"}</button>}>
          {courses.length ? "Try another search or choose a different status." : "Create a course, add its lessons and publish a version before assigning students."}
        </Empty>}
      </DataState>
    </Panel>
  </AdminPage>;
}
function CourseEditor() {
  const { id } = useParams(),
    client = useQueryClient(),
    navigate = useNavigate(),
    data = useData<Course & { lessons: Lesson[] }>(
      `course-${id}`,
      `platform/courses/${id}`,
    );
  const [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [loaded, setLoaded] = useState(""),
    [lifecyclePending, setLifecyclePending] = useState(false),
    [uploading, setUploading] = useState(false),
    [tab, setTab] = useState<"content" | "submissions">("content"),
    [notice, setNotice] = useState("");
  const issues = lessons.flatMap((lesson, index) => { const message = lessonValidation(lesson); return message ? [`Lesson ${index + 1}: ${message}`] : []; });
  const archived = data.data?.status === "archived";
  const unsaved = Boolean(data.data && (title !== data.data.title || description !== data.data.description || JSON.stringify(lessons) !== JSON.stringify(data.data.lessons)));
  useEffect(() => {
    if (data.data && loaded !== `${id}:${data.data.versionId || ""}:${data.data.status}`) {
      setTitle(data.data.title);
      setDescription(data.data.description);
      setLessons(
        data.data.lessons.length
          ? data.data.lessons
          : [{ id: crypto.randomUUID(), title: "", body: "", kind: "text", format: "markdown" }],
      );
      setLoaded(`${id}:${data.data.versionId || ""}:${data.data.status}`);
    }
  }, [data.data, id, loaded]);
  const publish = useMutation({
    mutationFn: (input: {
      courseId: string;
      title: string;
      description: string;
      lessons: Lesson[];
    }) =>
      api<{
        id: string;
        number: number;
        title: string;
        description: string;
        lessons: Lesson[];
      }>(`platform/courses/${input.courseId}/publish`, "POST", {
        title: input.title,
        description: input.description,
        lessons: input.lessons,
      }),
    onSuccess: async (result, input) => {
      const key = ["platform", `course-${input.courseId}`];
      await client.cancelQueries({ queryKey: key, exact: true });
      client.setQueryData<Course & { lessons: Lesson[] }>(key, (course) =>
        course ? {
          ...course,
          title: result.title,
          description: result.description,
          status: "published",
          versionId: result.id,
          version: result.number,
          lessons: result.lessons,
        } : undefined,
      );
      await updateCachedList<Course>(client, ["platform", "courses"], (items) =>
        items.map((course) => course.id === input.courseId ? {
          ...course,
          title: result.title,
          description: result.description,
          status: "published",
          version: result.number,
          versionId: result.id,
        } : course).sort((a, b) => a.title.localeCompare(b.title)),
      );
      setNotice(
        `Version ${result.number} published. Existing assignments keep their previous version.`,
      );
      void client.invalidateQueries({ queryKey: ["platform", "access"] });
      void client.invalidateQueries({ queryKey: ["platform", "summary"] });
    },
  });
  useEffect(() => {
    if (!unsaved && !uploading) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, uploading]);
  return (
    <AdminPage
      title="Course editor"
      description="Create reading lessons, videos, assignments and MCQs in one learning experience."
      action={<Link to="/courses" className="btn">Back to courses</Link>}
    >
      <DataState pending={data.isPending} error={data.error}>
        {archived && <div className="access-archived-notice" role="status"><div><strong>Archived course · view only</strong><p>Existing assignments and progress are preserved. Restore this course to edit, publish a new version or make it available for new learning selections.</p></div></div>}
        {data.data && <Panel title={data.data.title || "Course status"} action={<span className={`badge ${data.data.status === "published" ? "green" : "amber"}`}>{data.data.status}{data.data.version ? ` · Version ${data.data.version}` : ""}</span>}>
          <CourseActions course={data.data} onChanged={setNotice} onDeleted={() => navigate("/courses")} disabled={publish.isPending || uploading} unsaved={unsaved && !archived} onPending={setLifecyclePending} />
        </Panel>}
        <div className="course-editor-tabs" role="group" aria-label="Course workspace">
          <button type="button" className="btn" disabled={uploading || publish.isPending} aria-pressed={tab === "content"} onClick={() => setTab("content")}>Lessons & content</button>
          <button type="button" className="btn" disabled={uploading || publish.isPending} aria-pressed={tab === "submissions"} onClick={() => setTab("submissions")}>Student submissions</button>
        </div>
        {tab === "content" ? <form onSubmit={event => {
          event.preventDefault();
          if (!archived && !lifecyclePending && !uploading && !issues.length && lessons.length) publish.mutate({ courseId: id!, title, description, lessons });
        }}>
          <Panel title="Course details">
            <div className="course-settings-grid">
              <Field label="Course title"><input required maxLength={150} value={title} readOnly={archived} onChange={event => setTitle(event.target.value)} disabled={publish.isPending || lifecyclePending || uploading} /></Field>
              <Field label="Course description"><textarea required maxLength={2000} rows={3} value={description} readOnly={archived} onChange={event => setDescription(event.target.value)} disabled={publish.isPending || lifecyclePending || uploading} /></Field>
            </div>
          </Panel>
          <CourseLessonBuilder courseId={id!} lessons={lessons} onChange={setLessons} disabled={publish.isPending || lifecyclePending} readOnly={archived} onUploadStateChange={setUploading} />
          {!archived && <>
            {issues.length > 0 && <div className="course-validation-summary"><strong>{issues.length} {issues.length === 1 ? "lesson needs" : "lessons need"} a little more detail before publishing</strong><ul>{issues.slice(0, 5).map(issue => <li key={issue}>{issue}</li>)}</ul>{issues.length > 5 && <p>And {issues.length - 5} more. Select a lesson in the outline to finish it.</p>}</div>}
            <div className="course-publish-bar"><div><strong>{uploading ? "Uploading your video…" : unsaved ? "Your next course version" : "Published content is up to date"}</strong><p>{uploading ? "Keep this page open while the video uploads." : "Publishing preserves existing students’ assigned versions and progress."}</p></div><button className="btn primary" disabled={publish.isPending || lifecyclePending || uploading || Boolean(issues.length) || !lessons.length || !title.trim() || !description.trim()}>{publish.isPending ? "Publishing…" : "Publish new version"}</button></div>
          </>}
          <ErrorMessage error={publish.error} />
        </form> : <CourseSubmissions courseId={id!} lessons={data.data?.lessons || []} />}
        {notice && <p className="success-note" role="status">{notice}</p>}
      </DataState>
    </AdminPage>
  );
}

function Jobs() {
  const org = useOrganizations(),
    query = useQueryClient(),
    data = useData<Job[]>(
      `jobs-${org.selected}`,
      `platform/jobs?organizationId=${org.selected}`,
      Boolean(org.selected),
    );
  const [title, setTitle] = useState(""),
    [company, setCompany] = useState(""),
    [description, setDescription] = useState(""),
    [url, setUrl] = useState(""),
    [audience, setAudience] = useState(""),
    [notice, setNotice] = useState("");
  const organizations = org.query.data ?? [];
  const activeOrganizations = organizations.filter(item => item.status === "active");
  const allOrganizations = audience === "all";
  const targetOrganization = activeOrganizations.find(item => item.id === audience);
  const canPublish = activeOrganizations.length > 0 && (allOrganizations || Boolean(targetOrganization));
  useEffect(() => {
    if (!audience && activeOrganizations.length) {
      setAudience(activeOrganizations.find(item => item.id === org.selected)?.id ?? activeOrganizations[0]!.id);
    }
  }, [audience, org.selected, org.query.data]);
  type PublishInput = {
    title: string; company: string; description: string; url: string;
  } & ({ audience: "all" } | { organizationId: string });
  const publish = useMutation({
    mutationFn: (input: PublishInput) => api<Job | { publishedCount: number; organizationIds: string[] }>("platform/jobs", "POST", input),
    onSuccess: async (result, input) => {
      if ("publishedCount" in result) {
        await Promise.all(result.organizationIds.map(organizationId =>
          query.invalidateQueries({ queryKey: ["platform", `jobs-${organizationId}`], exact: true }),
        ));
        setNotice(`“${input.title}” published to ${result.publishedCount} active organization${result.publishedCount === 1 ? "" : "s"}.`);
      } else if ("organizationId" in input) {
        await updateCachedList<Job>(query, ["platform", `jobs-${input.organizationId}`],
          items => [result, ...items.filter(item => item.id !== result.id)]);
        setNotice(`“${input.title}” published to ${organizations.find(item => item.id === input.organizationId)?.name ?? "the selected organization"}.`);
      }
      setTitle("");
      setCompany("");
      setDescription("");
      setUrl("");
    },
  });
  return (
    <AdminPage className="admin-jobs"
        title="Job opportunities"
        description="Share opportunities with one organization or all active organizations in one go."
        action={<div className="admin-header-select">
          <Field label="View jobs for">
            <AdminSelect aria-label="View jobs for" value={org.selected} onChange={org.setSelected} searchable
              disabled={org.query.isPending || !organizations.length} placeholder={org.query.isPending ? "Loading organizations…" : "No organizations yet"}
              options={organizations.map(item => ({ value: item.id, label: `${item.name}${item.status === "archived" ? " (Archived)" : ""}` }))} />
          </Field>
        </div>}
    >
      <DataState pending={org.query.isPending} error={org.query.error}>
        <div className="admin-jobs-layout">
          <Panel title="Publish a job">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!canPublish || publish.isPending) return;
                setNotice("");
                publish.mutate({
                  ...(allOrganizations ? { audience: "all" as const } : { organizationId: audience }),
                  title,
                  company,
                  description,
                  url,
                });
              }}
            >
              <fieldset disabled={publish.isPending || !activeOrganizations.length}>
              <div className="admin-job-audience">
                <Field label="Publish to">
                  <AdminSelect aria-label="Publish to" value={audience} onChange={setAudience} required searchable
                    placeholder="Choose an audience" aria-describedby="job-audience-help"
                    options={[
                      { value: "all", label: "All active organizations", disabled: !activeOrganizations.length },
                      ...activeOrganizations.map(item => ({ value: item.id, label: item.name })),
                    ]} />
                </Field>
                <p id="job-audience-help">
                  {allOrganizations
                    ? `Share with all ${activeOrganizations.length} currently active organizations. Archived and future organizations are not included.`
                    : "Share only with the selected organization."}
                </p>
                <span className="admin-job-access-note">Students need Jobs access to see this opportunity.</span>
              </div>
              <div className="admin-job-details-row">
              <Field label="Job title">
                <input
                  required
                  maxLength={150}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Company">
                <input
                  required
                  maxLength={150}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </Field>
              </div>
              <Field label="Short description">
                <textarea
                  required
                  maxLength={3000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
              <Field label="Original application link">
                <input
                  type="url"
                  required
                  placeholder="https://…"
                  maxLength={2000}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
              <p className="admin-job-link-help">Students apply on the original website through this link.</p>
              <ErrorMessage error={publish.error} />
              <button className="btn primary admin-job-publish" disabled={publish.isPending || !canPublish}>
                {publish.isPending ? "Publishing…" : allOrganizations ? "Publish to all organizations" : "Publish job"}
              </button>
              </fieldset>
              {!activeOrganizations.length && <p className="note">Create or restore an active organization before publishing. <Link to="/organizations">Manage organizations →</Link></p>}
              {notice && <p className="success-note" role="status">{notice}</p>}
            </form>
          </Panel>
          <Panel title="Published opportunities" action={org.selected && data.data ? <span className="admin-count" aria-label={`${data.data.length} published opportunities`}>{data.data.length} jobs</span> : undefined}>
            {org.selected ? <DataState pending={data.isPending} error={data.error}>
              {data.data?.length ? (
                <div className="admin-job-list">
                  {data.data.map((job) => (
                    <article key={job.id} className="admin-job-card">
                      <div className="admin-job-meta">
                        <span className="eyebrow">{job.company}</span>
                        <time dateTime={job.postedAt}>{new Date(job.postedAt).toLocaleDateString("en-IN")}</time>
                      </div>
                      <h3>{job.title}</h3>
                      <p>{job.description}</p>
                      <a href={job.url} target="_blank" rel="noopener noreferrer">Open original posting ↗</a>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty title="No jobs published">
                  {organizations.find(item => item.id === org.selected)?.status === "archived"
                    ? "This organization is archived and does not receive new job postings."
                    : "Publish an opportunity to share it with this organization’s eligible students."}
                </Empty>
              )}
            </DataState> : <Empty title="No organizations yet">Create an organization to start sharing opportunities.</Empty>}
          </Panel>
        </div>
      </DataState>
    </AdminPage>
  );
}
function Integrations() {
  const data = useData<IntegrationStatus>(
    "integrations",
    "platform/integrations",
  );
  return (
    <AdminPage
        title="Connected services"
        description="Provider configuration for the platform."
    >
      <DataState pending={data.isPending} error={data.error}>
        {data.data && (
          <div className="split">
            <Panel title="Service configuration">
              {[
                [
                  "Database",
                  data.data.database === "local-postgres"
                    ? "Local PostgreSQL · development"
                    : "PostgreSQL",
                ],
                ["Authentication", "Better Auth · revocable sessions"],
                [
                  "Resend email",
                  data.data.email ? "Configured" : "Not configured",
                ],
                [
                  "WhatsApp verification",
                  data.data.whatsapp ? "Configured" : "Not configured",
                ],
                [
                  "Private R2 storage",
                  data.data.storage ? "Configured" : "Not configured",
                ],
                ["Code execution", "Provider trial pending"],
              ].map(([name, value]) => (
                <div className="integration-row" key={name}>
                  <strong>{name}</strong>
                  <span className="badge">{value}</span>
                </div>
              ))}
            </Panel>
            <Panel title="Before onboarding students">
              <p className="muted">
                Configure the approved WhatsApp sender and authentication
                template before issuing student accounts. Configure the email
                sending domain for password resets.
              </p>
              <p className="note">
                Credentials are managed in server configuration. This page never
                displays API keys or permanent passwords.
              </p>
            </Panel>
          </div>
        )}
      </DataState>
    </AdminPage>
  );
}
export function PlatformRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route element={<Protected />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route element={<AdminShell navigation={navigation} />}>
          <Route index element={<AdminDashboard />} />
          <Route path="organizations" element={<Organizations />} />
          <Route path="registrations" element={<Registrations />} />
          <Route path="members" element={<Members />} />
          <Route path="access" element={<LearningAccess />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/:id" element={<CourseEditor />} />
          <Route path="exams" element={<Exams />} />
          <Route path="exams/new" element={<ExamEditor />} />
          <Route path="exams/:id" element={<ExamEditor />} />
          <Route path="assessments" element={<Navigate to="/exams" replace />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="announcements" element={<Announcements />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
