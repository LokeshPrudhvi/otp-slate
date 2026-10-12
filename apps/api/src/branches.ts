import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { OrganizationBranch } from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import * as s from "./schema.js";

export const branchCodeInput = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/,
    "Use letters, numbers, spaces, hyphens, underscores, dots or slashes for the branch code.",
  )
  .transform((value) => value.toUpperCase());
export const branchNameInput = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Remove control characters.",
  )
  .transform((value) => value.replace(/\s+/g, " "));
export const createBranchInput = z
  .object({ code: branchCodeInput, name: branchNameInput })
  .strict();
export const updateBranchInput = createBranchInput
  .extend({ revision: z.number().int().min(0) })
  .strict();

// All branch-dependent writers take the shared lock before any row locks.
// A rename takes the exclusive lock first, so no in-flight writer can save
// an obsolete code after the rename updates its dependent records.
export async function lockOrganizationBranches(
  tx: Transaction,
  organizationId: string,
  exclusive = false,
) {
  const key = `slate:organization-branches:${organizationId}`;
  await tx.execute(
    exclusive
      ? sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      : sql`select pg_advisory_xact_lock_shared(hashtextextended(${key}, 0))`,
  );
}
const columns = {
  organizationId: s.organizationBranches.organizationId,
  code: s.organizationBranches.code,
  name: s.organizationBranches.name,
};
const normalizedName = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();

export async function requireOrganizationBranch(
  tx: Transaction,
  organizationId: string,
  code: string,
  name?: string,
): Promise<OrganizationBranch> {
  const [branch] = await tx
    .select(columns)
    .from(s.organizationBranches)
    .where(
      and(
        eq(s.organizationBranches.organizationId, organizationId),
        eq(s.organizationBranches.code, branchCodeInput.parse(code)),
      ),
    );
  if (!branch)
    throw new BadRequestException(
      "Choose a branch created for this organization. Ask Platform Admin to add it first.",
    );
  if (
    name !== undefined &&
    normalizedName(name) !== normalizedName(branch.name)
  )
    throw new BadRequestException(
      `Branch ${branch.code} is named ${branch.name}. Select the matching branch from this organization.`,
    );
  return branch;
}

async function rejectRetiredBranchCode(
  tx: Transaction,
  organizationId: string,
  code: string,
  branchId?: string,
) {
  const [used] = await tx
    .select({ id: s.audit.id })
    .from(s.audit)
    .where(
      and(
        eq(s.audit.organizationId, organizationId),
        eq(s.audit.action, "branch.updated"),
        sql`${s.audit.details}->'before'->>'code' = ${code}`,
        sql`${s.audit.details}->'before'->>'code' IS DISTINCT FROM ${s.audit.details}->'after'->>'code'`,
        branchId
          ? sql`${s.audit.details}->>'branchId' IS DISTINCT FROM ${branchId}`
          : undefined,
      ),
    )
    .limit(1);
  if (used)
    throw new ConflictException(
      "This code was previously used by another branch. Choose a different code.",
    );
}

export class BranchService {
  constructor(private readonly service: SlateService) {}
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException("Only Platform Admin can manage branches.");
  }
  private async organization(
    tx: Transaction,
    organizationId: string,
    lock = false,
  ) {
    const query = tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, organizationId));
    const [organization] = lock ? await query.for("update") : await query;
    if (!organization) throw new NotFoundException("Organization not found.");
    return organization;
  }
  async list(
    actor: Actor,
    organizationId: string,
  ): Promise<OrganizationBranch[]> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      await this.organization(tx, organizationId);
      return tx
        .select(columns)
        .from(s.organizationBranches)
        .where(eq(s.organizationBranches.organizationId, organizationId))
        .orderBy(
          asc(s.organizationBranches.name),
          asc(s.organizationBranches.code),
        );
    });
  }
  async create(
    actor: Actor,
    organizationId: string,
    raw: z.infer<typeof createBranchInput>,
  ): Promise<OrganizationBranch> {
    this.admin(actor);
    const input = createBranchInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      await lockOrganizationBranches(tx, organizationId);
      const organization = await this.organization(tx, organizationId, true);
      if (organization.status !== "active")
        throw new BadRequestException(
          "Activate the organization before creating a branch.",
        );
      await rejectRetiredBranchCode(tx, organizationId, input.code);
      // The organization lock serializes creation, including case-insensitive names.
      const [existing] = await tx
        .select(columns)
        .from(s.organizationBranches)
        .where(
          and(
            eq(s.organizationBranches.organizationId, organizationId),
            sql`(${s.organizationBranches.code} = ${input.code} or lower(${s.organizationBranches.name}) = ${input.name.toLowerCase()})`,
          ),
        );
      if (existing)
        throw new ConflictException(
          "A branch with this name or code already exists in this organization. Select the existing branch.",
        );
      const [branch] = await tx
        .insert(s.organizationBranches)
        .values({ organizationId, ...input })
        .returning(columns);
      await tx
        .update(s.organizations)
        .set({
          accessRevision: organization.accessRevision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.organizations.id, organizationId));
      await this.service.log(
        tx,
        actor,
        "branch.created",
        organizationId,
        branch.code,
      );
      return branch;
    });
  }
  async update(
    actor: Actor,
    organizationId: string,
    originalCode: string,
    raw: z.infer<typeof updateBranchInput>,
  ): Promise<OrganizationBranch> {
    this.admin(actor);
    const input = updateBranchInput.parse(raw);
    const code = branchCodeInput.parse(originalCode);
    return this.service.scope(actor, async (tx) => {
      await lockOrganizationBranches(tx, organizationId, true);
      const organization = await this.organization(tx, organizationId, true);
      if (organization.status !== "active")
        throw new BadRequestException(
          "Activate the organization before editing a branch.",
        );
      if (organization.accessRevision !== input.revision)
        throw new ConflictException(
          "This organization changed in another session. Reload the branch before saving.",
        );
      const [before] = await tx
        .select({ ...columns, id: s.organizationBranches.id })
        .from(s.organizationBranches)
        .where(
          and(
            eq(s.organizationBranches.organizationId, organizationId),
            eq(s.organizationBranches.code, code),
          ),
        );
      if (!before)
        throw new ConflictException(
          "This branch has changed or is no longer available. Reload the branch list.",
        );
      if (before.name === input.name && before.code === input.code)
        return { organizationId, code: before.code, name: before.name };
      await rejectRetiredBranchCode(tx, organizationId, input.code, before.id);
      const [duplicate] = await tx
        .select(columns)
        .from(s.organizationBranches)
        .where(
          and(
            eq(s.organizationBranches.organizationId, organizationId),
            sql`${s.organizationBranches.code} <> ${code}`,
            sql`(${s.organizationBranches.code} = ${input.code} or lower(${s.organizationBranches.name}) = ${input.name.toLowerCase()})`,
          ),
        );
      if (duplicate)
        throw new ConflictException(
          "A branch with this name or code already exists in this organization.",
        );
      // Every dependent row keeps its existing identity, assignments, version
      // pins and progress. Only the branch labels and policy lookup key change.
      const [updated] = await tx
        .update(s.organizationBranches)
        .set({ code: input.code, name: input.name })
        .where(
          and(
            eq(s.organizationBranches.organizationId, organizationId),
            eq(s.organizationBranches.code, code),
          ),
        )
        .returning(columns);
      await tx
        .update(s.members)
        .set({
          branchCode: input.code,
          branchName: input.name,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.members.organizationId, organizationId),
            sql`upper(btrim(${s.members.branchCode})) = ${code}`,
          ),
        );
      await tx.execute(sql`update registration_requests set branch_code=${input.code}, branch_name=${input.name}
        where org_id=${organizationId} and upper(btrim(branch_code))=${code}`);
      await tx
        .update(s.accessPolicies)
        .set({
          targetKey: input.code,
          branchName: input.name,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.accessPolicies.organizationId, organizationId),
            eq(s.accessPolicies.scope, "branch"),
            eq(s.accessPolicies.targetKey, code),
          ),
        );
      await tx
        .update(s.announcements)
        .set({
          branchCode: input.code,
          branchName: input.name,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(s.announcements.organizationId, organizationId),
            eq(s.announcements.branchCode, code),
          ),
        );
      await tx
        .update(s.organizations)
        .set({
          accessRevision: organization.accessRevision + 1,
          updatedAt: new Date(),
        })
        .where(eq(s.organizations.id, organizationId));
      await tx.insert(s.audit).values({
        actorId: actor.id,
        organizationId,
        action: "branch.updated",
        resourceId: input.code,
        details: {
          branchId: before.id,
          before: { code: before.code, name: before.name },
          after: { code: input.code, name: input.name },
        },
      });
      return updated;
    });
  }
}
