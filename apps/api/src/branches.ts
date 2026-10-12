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
      const organization = await this.organization(tx, organizationId, true);
      if (organization.status !== "active")
        throw new BadRequestException(
          "Activate the organization before creating a branch.",
        );
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
}
