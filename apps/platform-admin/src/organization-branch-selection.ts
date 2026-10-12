import type { OrganizationBranch } from "@slate/contracts";

export function selectedOrganizationBranch(branches: OrganizationBranch[] | undefined, organizationId: string, code: string) {
  return branches?.find(branch => branch.organizationId === organizationId && branch.code === code);
}

