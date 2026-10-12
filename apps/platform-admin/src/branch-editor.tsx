import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AccessWorkspace, OrganizationBranch } from "@slate/contracts";
import { api, ApiError, ErrorMessage, Field, Icon } from "@slate/ui";

export function EditBranch({ branch, revision: initialRevision, studentCount, onSaved, onCancel, onDirty, onPending, loadWorkspace }: {
  branch: OrganizationBranch;
  revision: number;
  studentCount: number;
  onSaved: (updated: OrganizationBranch) => Promise<void>;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
  loadWorkspace: () => Promise<AccessWorkspace>;
}) {
  const [baseline, setBaseline] = useState(branch);
  const [name, setName] = useState(branch.name);
  const [code, setCode] = useState(branch.code);
  const [revision, setRevision] = useState(initialRevision);
  const [validation, setValidation] = useState("");
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [committed, setCommitted] = useState<OrganizationBranch | null>(null);
  const normalizedName = name.trim().replace(/\s+/g, " ");
  const normalizedCode = code.trim().toUpperCase();
  const dirty = normalizedName !== baseline.name || normalizedCode !== baseline.code;
  async function refreshSaved(updated: OrganizationBranch) {
    setRefreshError(null);
    setRefreshing(true);
    try { await onSaved(updated); }
    catch (error) { setRefreshError(error); }
    finally { setRefreshing(false); }
  }
  const save = useMutation({
    mutationFn: () => api<OrganizationBranch>(`platform/organizations/${branch.organizationId}/branches/${encodeURIComponent(baseline.code)}`, "PATCH", {
      name: normalizedName, code: normalizedCode, revision,
    }),
    onSuccess: async updated => {
      setCommitted(updated);
      await refreshSaved(updated);
    },
  });
  const stale = save.error instanceof ApiError && save.error.status === 409 && [
    "This organization changed in another session. Reload the branch before saving.",
    "This branch has changed or is no longer available. Reload the branch list.",
  ].includes(save.error.message);
  const pending = save.isPending || refreshing;
  // A successful PATCH must be followed by a fresh workspace before access editing resumes.
  useEffect(() => onPending(pending || Boolean(committed)), [pending, committed, onPending]);
  useEffect(() => onDirty(dirty || Boolean(committed)), [dirty, committed, onDirty]);
  useEffect(() => {
    if (!dirty && !committed) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, committed]);
  async function reviewLatest() {
    setRefreshError(null);
    setRefreshing(true);
    try {
      const latest = await loadWorkspace();
      const current = latest.branches.find(item => item.code === baseline.code);
      if (!current) throw new Error("This branch’s code changed elsewhere. Your draft is preserved here. Cancel and select the updated branch from the list before editing again.");
      if (latest.organization.status !== "active") throw new Error("The organization is archived. Restore it before editing its branches.");
      setBaseline({ organizationId: branch.organizationId, name: current.name, code: current.code });
      setRevision(latest.revision);
      setReviewed(true);
      save.reset();
    } catch (error) { setRefreshError(error); }
    finally { setRefreshing(false); }
  }
  return <section className="access-card branch-editor-card" aria-label="Edit academic branch">
    <div className="access-section-title"><Icon name="users" /><div><h2>Edit branch</h2><p>Update the official name or code for {baseline.name}.</p></div></div>
    <form aria-busy={pending} onSubmit={event => {
      event.preventDefault();
      if (!dirty || pending || committed || stale) return;
      if (!normalizedName || normalizedName.length > 120) { setValidation("Enter a branch name of up to 120 characters."); return; }
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,31}$/.test(normalizedCode)) { setValidation("Use a branch code of up to 32 characters, starting with a letter or number."); return; }
      setValidation("");
      save.mutate();
    }}>
      <fieldset disabled={pending || Boolean(committed)}>
        <div className="form-grid">
          <Field label="Branch name" hint="The official department name shown on student forms and reports."><input aria-label="Branch name" required maxLength={120} autoComplete="off" value={name} onChange={event => { setName(event.target.value); setValidation(""); if (save.isError && !stale) save.reset(); }} /></Field>
          <Field label="Branch code" hint="A unique code within this organization."><input aria-label="Branch code" required maxLength={32} autoComplete="off" spellCheck={false} value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setValidation(""); if (save.isError && !stale) save.reset(); }} /></Field>
        </div>
      </fieldset>
      <div className="branch-catalog-note"><strong>Updates the branch everywhere</strong><p>{studentCount} {studentCount === 1 ? "student" : "students"} assigned to this branch, registration records, branch access rules and announcement audiences will use the updated details. Assigned learning and student progress are preserved.</p></div>
      {reviewed && !stale && <p className="branch-review-note" role="status">Latest branch: {baseline.name} ({baseline.code}). Your draft is preserved above. Review it before saving again.</p>}
      {!committed && <ErrorMessage error={validation ? new Error(validation) : save.error} />}
      {committed && <p className="branch-review-note" role="status"><strong>Branch saved.</strong> {refreshing ? "Refreshing learning access…" : "Reload learning access to continue with the updated branch."}</p>}
      <ErrorMessage error={refreshError} />
      {committed ? <button type="button" className="btn primary" disabled={pending} onClick={() => { void refreshSaved(committed); }}>{pending ? "Refreshing access…" : "Retry loading access"}</button> : <div className="actions">
        <button type="submit" className="btn primary" disabled={!dirty || pending || stale}>{save.isPending ? "Saving branch…" : "Save branch"}</button>
        {stale && <button type="button" className="btn" disabled={pending} onClick={() => { void reviewLatest(); }}>{refreshing ? "Loading latest…" : "Review latest branch"}</button>}
        <button type="button" className="btn" disabled={pending} onClick={onCancel}>Cancel</button>
      </div>}
    </form>
  </section>;
}
