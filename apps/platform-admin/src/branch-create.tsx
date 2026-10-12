import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { OrganizationBranch } from "@slate/contracts";
import { api, ErrorMessage, Field, Icon } from "@slate/ui";

export function CreateBranch({ organizationId, organizationName, onCreated, onDirty, onPending }: {
  organizationId: string;
  organizationName: string;
  onCreated: (branch: OrganizationBranch) => void;
  onDirty: (dirty: boolean) => void;
  onPending: (pending: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [validation, setValidation] = useState("");
  const create = useMutation({
    mutationFn: () => api<OrganizationBranch>(`platform/organizations/${organizationId}/branches`, "POST", { name: name.trim().replace(/\s+/g, " "), code: code.trim().toUpperCase() }),
    onSuccess: onCreated,
  });
  const dirty = Boolean(name.trim() || code.trim()) && !create.isSuccess;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => onPending(create.isPending), [create.isPending, onPending]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  return <section className="access-card branch-create-card">
    <div className="access-section-title"><Icon name="users" /><div><h2>Create a branch</h2><p>Add a branch to {organizationName}. Students will select it from this organization’s branch list.</p></div></div>
    <form onSubmit={event => {
      event.preventDefault();
      if (create.isPending || create.isSuccess) return;
      if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,31}$/.test(code.trim())) {
        setValidation("Use a branch code of up to 32 characters, starting with a letter or number.");
        return;
      }
      setValidation("");
      create.mutate();
    }}>
      <fieldset disabled={create.isPending || create.isSuccess}>
        <div className="form-grid">
          <Field label="Branch name" hint="Use the official department name."><input required maxLength={120} autoComplete="off" value={name} placeholder="Computer Science and Engineering" onChange={event => { setName(event.target.value); create.reset(); }} /></Field>
          <Field label="Branch code" hint="A unique code within this organization, such as CSE or MECH."><input required maxLength={32} autoComplete="off" spellCheck={false} value={code} placeholder="CSE" onChange={event => { setCode(event.target.value.toUpperCase()); setValidation(""); create.reset(); }} /></Field>
        </div>
        <p className="branch-catalog-note">The selected branch will automatically fill its code on student forms. Editing branch details later updates the organization’s student records, learning access and announcement audiences together.</p>
        <ErrorMessage error={validation ? new Error(validation) : create.error} />
        <button className="btn primary" type="submit" disabled={create.isPending || create.isSuccess || !name.trim() || !code.trim()}>{create.isPending ? "Creating branch…" : create.isSuccess ? "Branch created" : "Create branch"}</button>
      </fieldset>
    </form>
  </section>;
}
