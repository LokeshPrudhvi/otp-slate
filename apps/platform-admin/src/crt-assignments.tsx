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
  const audience = useData<CrtAudience>(`crt:audience:${organizationId}`, `platform/crt/audience?organizationId=${encodeURIComponent(organizationId)}`, Boolean(organizationId));
  const branch = audience.data?.organizationId === organizationId ? audience.data.branches.find(item => item.id === branchId) : undefined;
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
    <div className="crt-assignment-heading"><div><h2>Assign a learning path</h2><p>Choose one organization and one of its branches. Topics keep their assigned content until you apply an update.</p></div><div className="crt-audience-controls">
      <Field label="Organization"><AdminSelect aria-label="CRT assignment organization" searchable value={organizationId} onChange={value => changeScope({ organizationId: value, branchId: "" })} placeholder="Select an organization" options={(organizations.data || []).filter(item => item.status === "active").map(item => ({ value: item.id, label: item.name }))} disabled={organizations.isPending || saving} /></Field>
      <Field label="Branch"><AdminSelect aria-label="CRT assignment branch" searchable value={branchId} onChange={id => changeScope({ organizationId, branchId: id })} placeholder={organizationId ? "Select a branch" : "Select organization first"} options={(audience.data?.organizationId === organizationId ? audience.data.branches : []).map(item => ({ value: item.id, label: `${item.name} (${item.code})` }))} disabled={!organizationId || audience.isPending || saving} /></Field>
    </div></div>
    {pendingScope && <div className="crt-scope-confirm" role="alert"><div><strong>Keep your unsaved branch changes?</strong><p>Changing the audience will discard selections that have not been updated.</p></div><div className="actions"><button type="button" className="btn" onClick={() => setPendingScope(null)}>Keep editing</button><button type="button" className="btn" onClick={() => applyScope(pendingScope)}>Discard and switch</button></div></div>}
    <ErrorMessage error={organizations.error || audience.error} />
    {notice && <p className="success-note" role="status">{notice}</p>}
    {!organizationId ? <Empty title="Choose an organization and branch">Create a focused CRT curriculum for one branch. Other organizations with the same branch code are unaffected.</Empty> : audience.isPending ? <p className="loading" role="status">Loading branches…</p> : organization?.status !== "active" ? <p className="note">Choose an active organization before changing CRT assignments.</p> : !audience.data?.branches.length ? <Empty title="Add a branch first" action={<Link className="btn" to={`/access?organizationId=${organizationId}&tab=branches`}>Manage branches →</Link>}>This organization needs a branch before you can assign CRT topics.</Empty> : !branch ? <Empty title="Choose this organization’s branch">Only students in the selected branch will receive the topics you assign here.</Empty> : <BranchAssignments key={`${organizationId}:${branch.id}`} organization={organization} branch={branch} topics={topics} topicsPending={topicsPending} topicsError={topicsError} onDirty={setDirty} onSaving={setSaving} onSaved={async () => { setNotice(`CRT assignments updated for ${branch.name} at ${organization.name}.`); await client.invalidateQueries({ queryKey: ["platform", `crt:assignments:${organizationId}:${branch.id}`] }); }} />}
  </>;
}

function BranchAssignments({ organization, branch, topics, topicsPending, topicsError, onSaved, onDirty, onSaving }: {
  organization: Organization; branch: CrtAudience["branches"][number]; topics: CrtTopic[]; topicsPending: boolean; topicsError: unknown; onSaved: () => Promise<void>;
  onDirty: (value: boolean) => void; onSaving: (value: boolean) => void;
}) {
  const query = useData<CrtAssignments>(`crt:assignments:${organization.id}:${branch.id}`, `platform/crt/assignments?organizationId=${organization.id}&branchId=${branch.id}`);
  const [edits, setEdits] = useState<CrtAssignments["topics"] | null>(null);
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const selected = edits ?? query.data?.topics ?? [];
  const published = topics.filter(topic => topic.versionId);
  const chosen = new Map(selected.map(item => [item.topicId, item.versionId]));
  const dirty = edits !== null && JSON.stringify([...selected].sort((a, b) => a.topicId.localeCompare(b.topicId))) !== JSON.stringify([...(query.data?.topics || [])].sort((a, b) => a.topicId.localeCompare(b.topicId)));
  const removed = (query.data?.topics || []).filter(item => !chosen.has(item.topicId)).length;
  const updated = (query.data?.topics || []).filter(item => chosen.has(item.topicId) && chosen.get(item.topicId) !== item.versionId).length;
  const save = useMutation({ mutationFn: () => api<CrtAssignments>("platform/crt/assignments", "PUT", { organizationId: organization.id, branchId: branch.id, topics: selected }), onSuccess: async () => { setEdits(null); setConfirming(false); await onSaved(); } });
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => { onSaving(save.isPending); }, [save.isPending, onSaving]);
  useEffect(() => () => { onDirty(false); onSaving(false); }, [onDirty, onSaving]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const change = (values: CrtAssignments["topics"]) => { setEdits(values); setConfirming(false); save.reset(); };
  return <DataState pending={topicsPending || query.isPending} error={topicsError || query.error}>
    <div className="crt-assignment-scope"><div><strong>{branch.name} <span>({branch.code})</span></strong><p>{organization.name}</p></div><div><strong>{branch.studentCount}</strong><span> students in this branch</span></div><div><strong>{selected.length}</strong><span> assigned topics</span></div></div>
    {!published.length ? <Empty title="Publish your first topic" action={<Link className="btn primary" to="/crt/new">Create a topic</Link>}>Topics become available for assignment once their PDF and assessment are published.</Empty> : <>
      <section className="panel"><div className="panel-head"><h2>Topics for this branch</h2><div className="crt-assignment-search"><input type="search" aria-label="Search assignable topics" placeholder="Search topics" value={search} onChange={event => setSearch(event.target.value)} /></div></div><div className="panel-body crt-assignment-subjects">
        {crtSubjects.map(subject => {
          const rows = published.filter(topic => topic.subjectId === subject.id && topic.title.toLowerCase().includes(search.toLowerCase()));
          if (!rows.length) return null;
          return <section className="crt-assignment-subject" key={subject.id}><h3>{subject.name}<span>{rows.filter(topic => chosen.has(topic.id)).length} / {rows.length}</span></h3>{rows.map(topic => {
            const earlier = chosen.has(topic.id) && chosen.get(topic.id) !== topic.versionId;
            return <div className={`crt-assignment-topic${chosen.has(topic.id) ? " selected" : ""}`} key={topic.id}>
              <label><input type="checkbox" checked={chosen.has(topic.id)} disabled={save.isPending} onChange={event => change(event.target.checked ? [...selected, { topicId: topic.id, versionId: topic.versionId! }] : selected.filter(item => item.topicId !== topic.id))} /><span><strong>{topic.title}</strong><small>{earlier ? "Content update available" : "Published"}{topic.status === "draft" ? " · Has unpublished changes" : ""}</small></span></label>
              {earlier ? <button type="button" className="btn" disabled={save.isPending} onClick={() => change(selected.map(item => item.topicId === topic.id ? { ...item, versionId: topic.versionId! } : item))}>Apply update</button> : <Link to={`/crt/topics/${topic.id}`} aria-label={`Edit ${topic.title}`}>View topic ↗</Link>}
            </div>;
          })}</section>;
        })}
        {!published.some(topic => topic.title.toLowerCase().includes(search.toLowerCase())) && <p className="muted">No topics match this search.</p>}
      </div></section>
      <div className="crt-assignment-help">Students also need the CRT section enabled in <Link to={`/access?organizationId=${organization.id}`}>Learning access</Link>. Removing or changing a topic preserves earlier attempts and completion history.</div>
      <ErrorMessage error={save.error} />
      <div className="crt-editor-save"><div><strong>{dirty ? "Ready to update this branch" : "Assignments are up to date"}</strong><p>{branch.name} · {organization.name}</p></div><div className="actions"><button className="btn" type="button" disabled={!dirty || save.isPending} onClick={() => { setEdits(null); setConfirming(false); save.reset(); }}>Reset</button><button className="btn primary" type="button" disabled={!dirty || save.isPending} onClick={() => setConfirming(true)}>Update assignments</button></div>
        {confirming && <div className="crt-publish-confirm" role="group" aria-label="Confirm branch assignments"><p>Assign {selected.length} topic{selected.length === 1 ? "" : "s"} to {branch.name} at {organization.name}.{removed ? ` ${removed} topic${removed === 1 ? " will" : "s will"} no longer be available to this branch.` : ""}{updated ? ` ${updated} topic${updated === 1 ? " will" : "s will"} receive updated content.` : ""} Existing progress remains saved.</p><div className="actions"><button type="button" className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Updating…" : "Confirm update"}</button><button type="button" className="btn" disabled={save.isPending} onClick={() => setConfirming(false)}>Cancel</button></div></div>}
      </div>
    </>}
  </DataState>;
}
