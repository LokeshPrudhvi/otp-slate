import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  Announcement,
  AnnouncementAudience,
  AnnouncementPage,
  OrganizationAnnouncement,
  PublishAnnouncement,
} from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import { normalizedBranch } from "./access.js";
import { demoAnnouncements } from "./demo-data.js";
import * as s from "./schema.js";

const branch = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9_-]+$/)
  .transform((value) => value.toUpperCase());
export const publishAnnouncementInput = z
  .object({
    clientId: z.string().uuid(),
    organizationId: z.string().uuid(),
    branchCode: branch.nullable(),
    title: z.string().trim().min(1).max(150),
    body: z.string().trim().min(1).max(10000),
    format: z.enum(["plain", "markdown"]),
  })
  .strict();
export const announcementListInput = z
  .object({
    organizationId: z.string().uuid(),
    status: z.enum(["published", "archived"]).default("published"),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
type Row = typeof s.announcements.$inferSelect;
const shape = (
  row: Row,
  organizationName: string,
): OrganizationAnnouncement => ({
  id: row.id,
  clientId: row.clientId,
  organizationId: row.organizationId,
  organizationName,
  branchCode: row.branchCode,
  branchName: row.branchName,
  title: row.title,
  body: row.body,
  format: row.format,
  status: row.status,
  date: row.createdAt.toISOString(),
  from: row.authorName,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export class AnnouncementService {
  constructor(private readonly service: SlateService) {}
  private admin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException(
        "Only Platform Admin can manage announcements.",
      );
  }
  private async organization(tx: Transaction, id: string, writing = false) {
    const query = tx
      .select()
      .from(s.organizations)
      .where(eq(s.organizations.id, id));
    const [organization] = writing ? await query.for("share") : await query;
    if (!organization) throw new NotFoundException("Organization not found.");
    return organization;
  }
  private active(status: string) {
    if (status !== "active")
      throw new BadRequestException(
        "Activate the organization before publishing an announcement.",
      );
  }
  private async branches(tx: Transaction, organizationId: string) {
    const people = await tx
      .select({
        code: sql<
          string | null
        >`nullif(upper(btrim(${s.members.branchCode})), '')`,
        name: sql<
          string | null
        >`max(nullif(btrim(${s.members.branchName}), ''))`,
        studentCount: sql<number>`count(*) filter (where ${s.members.status} = 'active')::integer`,
      })
      .from(s.members)
      .where(
        and(
          eq(s.members.organizationId, organizationId),
          eq(s.members.role, "student"),
        ),
      )
      .groupBy(sql`nullif(upper(btrim(${s.members.branchCode})), '')`);
    const policies = await tx
      .select({
        code: s.accessPolicies.targetKey,
        name: s.accessPolicies.branchName,
      })
      .from(s.accessPolicies)
      .where(
        and(
          eq(s.accessPolicies.organizationId, organizationId),
          eq(s.accessPolicies.scope, "branch"),
        ),
      );
    const branches = new Map<
      string,
      AnnouncementAudience["branches"][number]
    >();
    for (const member of people)
      if (member.code)
        branches.set(member.code, {
          code: member.code,
          name: member.name || member.code,
          studentCount: member.studentCount,
        });
    for (const policy of policies) {
      const code = normalizedBranch(policy.code);
      if (code)
        branches.set(code, {
          code,
          name: policy.name?.trim() || branches.get(code)?.name || code,
          studentCount: branches.get(code)?.studentCount || 0,
        });
    }
    return {
      studentCount: people.reduce((sum, row) => sum + row.studentCount, 0),
      branches: [...branches.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    };
  }
  audience(
    actor: Actor,
    organizationId: string,
  ): Promise<AnnouncementAudience> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const organization = await this.organization(tx, organizationId);
      return {
        organizationId,
        organizationName: organization.name,
        status: organization.status as "active" | "archived",
        ...(await this.branches(tx, organizationId)),
      };
    });
  }
  list(
    actor: Actor,
    input: z.infer<typeof announcementListInput>,
  ): Promise<AnnouncementPage> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const organization = await this.organization(tx, input.organizationId);
      const condition = and(
        eq(s.announcements.organizationId, input.organizationId),
        eq(s.announcements.status, input.status),
      );
      const [total] = await tx
        .select({ value: count() })
        .from(s.announcements)
        .where(condition);
      const pageSize = 20;
      const page = Math.min(
        input.page,
        Math.max(1, Math.ceil(total.value / pageSize)),
      );
      const rows = await tx
        .select()
        .from(s.announcements)
        .where(condition)
        .orderBy(desc(s.announcements.createdAt), desc(s.announcements.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((row) => shape(row, organization.name)),
        total: total.value,
        page,
        pageSize,
      };
    });
  }
  publish(
    actor: Actor,
    supplied: PublishAnnouncement,
  ): Promise<OrganizationAnnouncement> {
    this.admin(actor);
    const input = publishAnnouncementInput.parse(supplied);
    return this.service.scope(actor, async (tx) => {
      const match = async (row: Row) => {
        if (
          row.organizationId !== input.organizationId ||
          row.branchCode !== input.branchCode ||
          row.title !== input.title ||
          row.body !== input.body ||
          row.format !== input.format ||
          row.createdBy !== actor.id
        )
          throw new ConflictException(
            "This publish request has already been used. Refresh the announcement list before retrying.",
          );
        const organization = await this.organization(tx, row.organizationId);
        return shape(row, organization.name);
      };
      const [existing] = await tx
        .select()
        .from(s.announcements)
        .where(eq(s.announcements.clientId, input.clientId));
      if (existing) return match(existing);
      const organization = await this.organization(
        tx,
        input.organizationId,
        true,
      );
      this.active(organization.status);
      const selected = input.branchCode
        ? (await this.branches(tx, input.organizationId)).branches.find(
            (item) => item.code === input.branchCode,
          )
        : null;
      if (input.branchCode && !selected)
        throw new BadRequestException(
          "Choose a branch belonging to this organization.",
        );
      const [created] = await tx
        .insert(s.announcements)
        .values({
          ...input,
          branchName: selected?.name || null,
          createdBy: actor.id,
          authorName: actor.name,
        })
        .onConflictDoNothing({ target: s.announcements.clientId })
        .returning();
      if (!created) {
        const [concurrent] = await tx
          .select()
          .from(s.announcements)
          .where(eq(s.announcements.clientId, input.clientId));
        return match(concurrent);
      }
      await this.service.log(
        tx,
        actor,
        "announcement.published",
        input.organizationId,
        created.id,
      );
      return shape(created, organization.name);
    });
  }
  update(
    actor: Actor,
    id: string,
    status: "published" | "archived",
  ): Promise<OrganizationAnnouncement> {
    this.admin(actor);
    return this.service.scope(actor, async (tx) => {
      const [before] = await tx
        .select()
        .from(s.announcements)
        .where(eq(s.announcements.id, id));
      if (!before) throw new NotFoundException("Announcement not found.");
      const organization = await this.organization(
        tx,
        before.organizationId,
        true,
      );
      if (status === "published") this.active(organization.status);
      const [current] = await tx
        .select()
        .from(s.announcements)
        .where(eq(s.announcements.id, id))
        .for("update");
      if (current.status === status) return shape(current, organization.name);
      const [updated] = await tx
        .update(s.announcements)
        .set({ status, updatedAt: new Date() })
        .where(eq(s.announcements.id, id))
        .returning();
      await this.service.log(
        tx,
        actor,
        status === "archived"
          ? "announcement.archived"
          : "announcement.restored",
        current.organizationId,
        id,
      );
      return shape(updated, organization.name);
    });
  }
  student(actor: Actor): Promise<Announcement[]> {
    if (actor.role !== "student" || !actor.organizationId)
      throw new ForbiddenException();
    this.service.feature(actor, "announcements");
    return this.service.scope(actor, async (tx) => {
      // Resolve the current membership, rather than trusting a branch cached in a session.
      const [member] = await tx
        .select({ branchCode: s.members.branchCode })
        .from(s.members)
        .innerJoin(
          s.organizations,
          eq(s.organizations.id, s.members.organizationId),
        )
        .where(
          and(
            eq(s.members.id, actor.id),
            eq(s.members.authUserId, actor.authId),
            eq(s.members.organizationId, actor.organizationId!),
            eq(s.members.role, "student"),
            eq(s.members.status, "active"),
            eq(s.organizations.status, "active"),
          ),
        );
      if (!member)
        throw new ForbiddenException(
          "This account is not active. Contact Platform Admin.",
        );
      const code = normalizedBranch(member.branchCode);
      const rows = await tx
        .select()
        .from(s.announcements)
        .where(
          and(
            eq(s.announcements.organizationId, actor.organizationId!),
            eq(s.announcements.status, "published"),
            code
              ? or(
                  isNull(s.announcements.branchCode),
                  eq(s.announcements.branchCode, code),
                )
              : isNull(s.announcements.branchCode),
          ),
        )
        .orderBy(desc(s.announcements.createdAt), desc(s.announcements.id))
        .limit(100);
      const items: Announcement[] = rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        date: row.createdAt.toISOString(),
        from: row.authorName,
        format: row.format,
        organizationId: row.organizationId,
        organizationName: actor.organizationName || "Organization",
        branchCode: row.branchCode,
        branchName: row.branchName,
      }));
      return [...items, ...(actor.demo ? demoAnnouncements() : [])].slice(
        0,
        100,
      );
    });
  }
}
