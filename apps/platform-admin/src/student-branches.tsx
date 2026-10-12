import type { OrganizationBranch } from "@slate/contracts";
import { ErrorMessage, Field, useData } from "@slate/ui";
import { Link } from "react-router-dom";
import { AdminSelect } from "./select";
import { selectedOrganizationBranch } from "./organization-branch-selection";
export { selectedOrganizationBranch } from "./organization-branch-selection";

export function useOrganizationBranches(organizationId: string) {
  return useData<OrganizationBranch[]>(`organization-branches-${organizationId}`,
    `platform/organizations/${organizationId}/branches`, Boolean(organizationId));
}

export function BranchFields({ organizationId, branches, code, onChange, pending, error, disabled = false, onRetry }: {
  organizationId: string;
  branches: OrganizationBranch[] | undefined;
  code: string;
  onChange: (branch: OrganizationBranch | undefined) => void;
  pending: boolean;
  error: unknown;
  disabled?: boolean;
  onRetry: () => void;
}) {
  const options = branches?.filter(branch => branch.organizationId === organizationId) || [];
  const selected = selectedOrganizationBranch(options, organizationId, code);
  const available = Boolean(organizationId) && !pending && !error && options.length > 0;
  return <>
    <Field label="Branch" hint="Choose a branch created for this organization.">
      <AdminSelect aria-label="Branch" required searchable value={selected?.code || ""}
        disabled={disabled || !available}
        onChange={value => onChange(selectedOrganizationBranch(options, organizationId, value))}
        options={[{ value: "", label: !organizationId ? "Choose an organization first" : pending ? "Loading branches…" : "Choose a branch" }, ...options.map(branch => ({ value: branch.code, label: branch.name }))]} />
    </Field>
    <Field label="Branch code" hint="Filled automatically from the selected branch.">
      <input aria-label="Branch code" className="registration-branch-code" value={selected?.code || ""} placeholder="Select a branch" readOnly />
    </Field>
    {!!organizationId && pending && <p className="registration-branch-notice" role="status">Loading this organization’s branches…</p>}
    {!!organizationId && !!error && <div className="registration-branch-notice"><ErrorMessage error={error} /><button type="button" className="link" onClick={onRetry} disabled={disabled}>Retry loading branches</button></div>}
    {!!organizationId && !pending && !error && !options.length && <p className="registration-branch-notice">Create a branch for this organization before adding students. <Link to={`/access?organizationId=${encodeURIComponent(organizationId)}&tab=branches`}>Manage branches →</Link></p>}
    {!!organizationId && available && !!code && !selected && <p className="registration-branch-notice" role="alert">The previous branch is no longer available. Select a branch from this organization.</p>}
  </>;
}
