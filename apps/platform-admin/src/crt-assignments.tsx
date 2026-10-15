import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crtSubjects, type CrtAssignments, type CrtAudience, type CrtTopic, type Organization } from "@slate/contracts";
import { api, DataState, Empty, ErrorMessage, Field, useData } from "@slate/ui";
import { AdminSelect } from "./select";

export function CrtAssignmentsPanel({ topics, topicsPending, topicsError }: { topics: CrtTopic[]; topicsPending: boolean; topicsError: unknown }) {
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const organizations = useData<Organization[]>("organizations", "platform/organizations");
  const organizationId = params.get("organizationId") || "";
  const organization = organizations.data?.find(item => item.id === organizationId);
  const [branchSelection, setBranchSelection] = useState({ organizationId: "", id: "" });
  const branchId = branchSelection.organizationId === organizationId ? branchSelection.id : "";
  const allBranches = branchId === "all";
  const audience = useData<CrtAudience>(`crt:audience:${organizationId}`, `platform/crt/audience?organizationId=${encodeURIComponent(organizationId)}`, Boolean(organizationId));
  const branches = audience.data?.organizationId === organizationId ? audience.data.branches : [];
  const branch = branches.find(item => item.id === branchId);
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingScope, setPendingScope] = useState<{ organizationId: string; branchId: string } | null>(null);
  const applyScope = (next: { organizationId: string; branchId: string }) => {
    setParams(current => { const copy = new URLSearchParams(current); copy.set("organizationId", next.organizationId); return copy; });
    setBranchSelection({ organizationId: next.organizationId, id: next.branchId });
    setPendingScope(null); setNotice("");
  };
  const changeScope = (next: { organizationId: string; branchId: string }) => {
    if (saving || next.organizationId === organizationId && next.branchId === branchId) return;
    if (dirty) setPendingScope(next); else applyScope(next);
  };
  return <>
    <div className="crt-assignment-heading"><div><h2>Assign a learning path</h2><p>Choose an organization, then all its branches or one branch. Topics keep their assigned content until you apply an update.</p></div><div className="crt-audience-controls">
      <Field label="Organization"><AdminSelect aria-label="CRT assignment organization" searchable value={organizationId} onChange={value => changeScope({ organizationId: value, branchId: "" })} placeholder="Select an organization" options={(organizations.data || []).filter(item => item.status === "active").map(item => ({ value: item.id, label: item.name }))} disabled={organizations.isPending || saving} /></Field>
      <Field label="Branch"><AdminSelect aria-label="CRT assignment branch" searchable value={branchId} onChange={id => changeScope({ organizationId, branchId: id })} placeholder={organizationId ? "Select branches" : "Select organization first"} options={organizationId ? [{ value: "all", label: "All branches" }, ...branches.map(item => ({ value: item.id, label: `${item.name} (${item.code})` }))] : []} disabled={!organizationId || audience.isPending || saving} /></Field>
    </div></div>
    {pendingScope && <div className="crt-scope-confirm" role="alert"><div><strong>Keep your unsaved assignment changes?</strong><p>Changing the audience will discard selections that have not been updated.</p></div><div className="actions"><button type="button" className="btn" onClick={() => setPendingScope(null)}>Keep editing</button><button type="button" className="btn" onClick={() => applyScope(pendingScope)}>Discard and switch</button></div></div>}
    <ErrorMessage error={organizations.error || audience.error} />
    {notice && <p className="success-note" role="status">{notice}</p>}
    {!organizationId ? <Empty title="Choose an organization">Assign CRT topics to all its branches or just one. Other organizations with the same branch code are unaffected.</Empty> : audience.isPending ? <p className="loading" role="status">Loading branches…</p> : organization?.status !== "active" ? <p className="note">Choose an active organization before changing CRT assignments.</p> : !allBranches && !branch ? <Empty title="Choose all branches or one branch">All branches includes branches added later to this organization. Students still need CRT access.</Empty> : <BranchAssignments key={`${organizationId}:${branchId}`} organization={organization} branch={branch ?? null} studentCount={allBranches ? branches.reduce((total, item) => total + item.studentCount, 0) : branch!.studentCount} topics={topics} topicsPending={topicsPending} topicsError={topicsError} onDirty={setDirty} onSaving={setSaving} onSaved={async () => { setNotice(`CRT assignments updated for ${allBranches ? "all branches" : branch!.name} at ${organization.name}.`); await client.invalidateQueries({ predicate: query => typeof query.queryKey[1] === "string" && query.queryKey[1].startsWith(`crt:assignments:${organizationId}:`) }); }} />}
  </>;
}

function BranchAssignments({ organization, branch, studentCount, topics, topicsPending, topicsError, onSaved, onDirty, onSaving }: {
  organization: Organization; branch: CrtAudience["branches"][number] | null; studentCount: number; topics: CrtTopic[]; topicsPending: boolean; topicsError: unknown; onSaved: () => Promise<void>;
  onDirty: (value: boolean) => void; onSaving: (value: boolean) => void;
}) {
  const scopeName = branch?.name ?? "All branches";
  const query = useData<CrtAssignments>(`crt:assignments:${organization.id}:${branch?.id ?? "all"}`, `platform/crt/assignments?organizationId=${encodeURIComponent(organization.id)}${branch ? `&branchId=${encodeURIComponent(branch.id)}` : ""}`);
  const [edits, setEdits] = useState<CrtAssignments["topics"] | null>(null);
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const selected = edits ?? query.data?.topics ?? [];
  const published = topics.filter(topic => topic.versionId);
  const chosen = new Map(selected.map(item => [item.topicId, item.versionId]));
  const inherited = new Map((query.data?.inheritedTopics || []).map(item => [item.topicId, item.versionId]));
  const effective = new Map([...chosen, ...inherited]);
  const dirty = edits !== null && JSON.stringify([...selected].sort((a, b) => a.topicId.localeCompare(b.topicId))) !== JSON.stringify([...(query.data?.topics || [])].sort((a, b) => a.topicId.localeCompare(b.topicId)));
  const removed = (query.data?.topics || []).filter(item => !chosen.has(item.topicId)).length;
  const updated = (query.data?.topics || []).filter(item => chosen.has(item.topicId) && chosen.get(item.topicId) !== item.versionId).length;
  const save = useMutation({ mutationFn: () => api<CrtAssignments>("platform/crt/assignments", "PUT", { organizationId: organization.id, branchId: branch?.id ?? null, topics: selected }), onSuccess: async () => { setEdits(null); setConfirming(false); await onSaved(); } });
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onSaving(save.isPending); }, [save.isPending, onSaving]);
  useEffect(() => () => { onDirty(false); onSaving(false); }, [onDirty, onSaving]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (values: CrtAssignments["topics"]) => { setEdits(values); setConfirming(false); save.reset(); };
  return <DataState pending={topicsPending || query.isPending} error={topicsError || query.error}>
    <div className="crt-assignment-scope"><div><strong>{scopeName} {branch && <span>({branch.code})</span>}</strong><p>{organization.name}{!branch && " · Current and future branches"}</p></div><div><strong>{studentCount}</strong><span> students {branch ? "in this branch" : "across branches"}</span></div><div><strong>{effective.size}</strong><span> assigned topics</span></div></div>
    {!published.length ? <Empty title="Publish your first topic" action={<Link className="btn primary" to="/crt/new">Create a topic</Link>}>Topics become available for assignment once their PDF and assessment are published.</Empty> : <>
      <section className="panel"><div className="panel-head"><h2>{branch ? "Topics for this branch" : "Topics for all branches"}</h2><div className="crt-assignment-search"><input type="search" aria-label="Search assignable topics" placeholder="Search topics" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="panel-body crt-assignment-subjects">
        {inherited.size > 0 && <p className="crt-inherited-note">Topics marked “All branches” are already included. Select All branches in the branch dropdown to change them. You can add more topics for this branch below.</p>}
        {crtSubjects.map(subject => {
          const rows = published.filter(topic => topic.subjectId === subject.id && topic.title.toLowerCase().includes(search.toLowerCase()));
          if (!rows.length) return null;
          return <section className="crt-assignment-subject" key={subject.id}><h3>{subject.name}<span>{rows.filter(topic => effective.has(topic.id)).length} / {rows.length}</span></h3>{rows.map(topic => {
            const isInherited = inherited.has(topic.id);
            const earlier = effective.has(topic.id) && effective.get(topic.id) !== topic.versionId;
            return <div className={`crt-assignment-topic${effective.has(topic.id) ? " selected" : ""}${isInherited ? " inherited" : ""}`} key={topic.id}>
              <label><input type="checkbox" checked={effective.has(topic.id)} disabled={save.isPending || isInherited} onChange={event => change(event.target.checked ? [...selected, { topicId: topic.id, versionId: topic.versionId! }] : selected.filter(item => item.topicId !== topic.id))} /><span><strong>{topic.title}</strong><small>{isInherited ? "All branches" : earlier ? "Content update available" : "Published"}{topic.status === "draft" ? " · Has unpublished changes" : ""}</small></span></label>
              {earlier && !isInherited ? <button type="button" className="btn" disabled={save.isPending} onClick={() => change(selected.map(item => item.topicId === topic.id ? { ...item, versionId: topic.versionId! } : item))}>Apply update</button> : <Link to={`/crt/topics/${topic.id}`} aria-label={`Edit ${topic.title}`}>View topic ↗</Link>}
            </div>;
          })}</section>;
        })}
        {!published.some(topic => topic.title.toLowerCase().includes(search.toLowerCase())) && <p className="muted">No topics match this search.</p>}
      </div></section>
      <div className="crt-assignment-help">Students also need the CRT section enabled in <Link to={`/access?organizationId=${organization.id}`}>Learning access</Link>. {!branch && "These topics apply to current and future branches in this organization. Individual branch assignments remain additional. "}Removing or changing a topic preserves earlier attempts and completion history.</div>
      <ErrorMessage error={save.error} />
      <div className="crt-editor-save"><div><strong>{dirty ? `Ready to update ${branch ? "this branch" : "all branches"}` : "Assignments are up to date"}</strong><p>{scopeName} · {organization.name}</p></div><div className="actions"><button className="btn" type="button" disabled={!dirty || save.isPending} onClick={() => { setEdits(null); setConfirming(false); save.reset(); }}>Reset</button><button className="btn primary" type="button" disabled={!dirty || save.isPending} onClick={() => setConfirming(true)}>Update assignments</button></div>
        {confirming && <div className="crt-publish-confirm" role="group" aria-label="Confirm branch assignments"><p>Make {effective.size} topic{effective.size === 1 ? "" : "s"} available to {scopeName} at {organization.name}.{!branch ? " This includes branches added later to this organization; additional branch assignments stay in place. If a topic is assigned both ways, students use the shared content." : inherited.size ? " Topics assigned to all branches remain included." : ""}{removed ? ` ${removed} topic${removed === 1 ? " will" : "s will"} be removed from this ${branch ? "branch’s" : "organization-wide"} selection.` : ""}{updated ? ` ${updated} topic${updated === 1 ? " will" : "s will"} receive updated content.` : ""} Existing progress remains saved.</p><div className="actions"><button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Updating…" : "Confirm update"}</button><button type="button" className="btn" disabled={save.isPending} onClick={() => setConfirming(false)}>Cancel</button></div></div>}
      </div>
    </>}
  </DataState>;
}
