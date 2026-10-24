import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  featureKeys,
  practiceModuleIds,
  type AccessPolicy,
  type AccessWorkspace,
  type EffectiveAccess,
  type FeatureKey,
  type PortalDisplay,
  type PracticeModuleId,
  type UpdateAccess,
} from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import * as s from "./schema.js";
import { demoOrganization, demoPractice } from "./demo-data.js";
import { jsonObject, jsonRows } from "./json-query.js";
import {
  branchCodeInput as branchCode,
  requireOrganizationBranch,
  lockOrganizationBranches,
} from "./branches.js";

const list = <T extends z.ZodType>(item: T, max: number) =>
  z
    .array(item)
    .max(max)
    .refine(
      (value) => new Set(value).size === value.length,
      "Remove duplicate selections.",
    )
    .nullable();
export const updateAccessInput = z
  .object({
    revision: z.number().int().min(0),
    scope: z.enum(["organization", "branch", "student"]),
    targetId: z.string().max(80).optional(),
    policy: z
      .object({
        features: list(z.enum(featureKeys), featureKeys.length),
        courseIds: list(z.string().uuid(), 500),
        practiceModuleIds: list(
          z.enum(practiceModuleIds),
          practiceModuleIds.length,
        ),
      })
      .strict(),
    branchName: z.string().trim().min(1).max(120).optional(),
    branchCode: branchCode.nullable().optional(),
    display: z
      .object({
        portalTitle: z.string().trim().min(1).max(80),
        welcomeText: z.string().trim().max(240),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope !== "organization" && !value.targetId)
      ctx.addIssue({
        code: "custom",
        message: "Choose a branch or student.",
        path: ["targetId"],
      });
    if (value.scope === "organization" && value.targetId)
      ctx.addIssue({
        code: "custom",
        message: "Organization policies do not use a target.",
        path: ["targetId"],
      });
    if (value.scope !== "organization" && value.display)
      ctx.addIssue({
        code: "custom",
        message: "Portal branding belongs to the organization.",
        path: ["display"],
      });
    if (value.scope !== "student" && value.branchCode !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Branch assignment belongs to a student.",
        path: ["branchCode"],
      });
  });
export const inheritPolicy = (): AccessPolicy => ({
  features: null,
  courseIds: null,
  practiceModuleIds: null,
});
export const defaultDisplay: PortalDisplay = {
  portalTitle: "Student portal",
  welcomeText:
    "Continue learning, practise your skills and track your progress.",
};
// Persisted JSON may outlive a portal feature. Only supported fields are exposed
// or used when resolving permissions; an explicit empty selection stays empty.
export function supportedFeatures(value: unknown): FeatureKey[] {
  return Array.isArray(value)
    ? [...new Set(value)].filter((key): key is FeatureKey =>
        featureKeys.includes(key as FeatureKey),
      )
    : [];
}
export function supportedPolicy(
  value: AccessPolicy | null | undefined,
): AccessPolicy {
  return {
    features:
      value?.features == null ? null : supportedFeatures(value.features),
    courseIds:
      value?.courseIds == null
        ? null
        : Array.isArray(value.courseIds)
          ? [...new Set(value.courseIds)].filter((id) => typeof id === "string")
          : [],
    practiceModuleIds:
      value?.practiceModuleIds == null
        ? null
        : Array.isArray(value.practiceModuleIds)
          ? [...new Set(value.practiceModuleIds)].filter((id) =>
              practiceModuleIds.includes(id),
            )
          : [],
  };
}
export function supportedDisplay(
  value: PortalDisplay | null | undefined,
): PortalDisplay {
  return {
    portalTitle: value?.portalTitle ?? defaultDisplay.portalTitle,
    welcomeText: value?.welcomeText ?? defaultDisplay.welcomeText,
  };
}
const coreFeatures: FeatureKey[] = [
  "courses",
  "crt",
  "pyq",
  "compiler",
  "practice",
  "live-exams",
  "inbox",
  "announcements",
  "self-assessment",
];
// Keep legacy policy values readable, but only offer the coding library now.
const competitiveModules: PracticeModuleId[] = ["competitive-coding"];
const features: AccessWorkspace["catalog"]["features"] = [
  ["courses", "Courses", "Published courses selected for this audience."],
  [
    "crt",
    "CRT",
    "PDF lessons and practice assigned to this organization and branch.",
  ],
  [
    "compiler",
    "Compiler",
    "Open the online compiler and coding problem workspace.",
  ],
  [
    "practice",
    "Coding",
    "DSA and coding problems with topic and difficulty filters.",
  ],
  ["live-exams", "Live exams", "View assigned live and upcoming exams."],
  ["inbox", "Inbox", "Send and read organization messages."],
  ["announcements", "Announcements", "Read organization announcements."],
  [
    "self-assessment",
    "Learning Progress",
    "Show CRT module and programming completion on the dashboard.",
  ],
  ["jobs", "Careers", "Browse jobs and external certification courses."],
  ["pyq", "PYQ", "Company hiring procedures, question papers and practice."],
  ["resume", "Resume builder", "Create and export a resume."],
  ["rankings", "Student rankings", "View the organization leaderboard."],
].map(([id, name, description]) => ({
  id: id as FeatureKey,
  name,
  description,
}));
type PolicyRecord = typeof s.accessPolicies.$inferSelect;
type MemberRecord = typeof s.members.$inferSelect;
type GrantRecord = typeof s.grants.$inferSelect;
type OrganizationRecord = typeof s.organizations.$inferSelect;
export const normalizedBranch = (value: string | null | undefined) =>
  value?.trim().toUpperCase() || null;

// A selection is inherited as a whole. Explicit organization selections are ceilings.
export function resolvePolicies(
  organization: OrganizationRecord,
  member: MemberRecord,
  records: PolicyRecord[],
  grants: GrantRecord[],
  demo: boolean,
) {
  records = records.map((row) => ({
    ...row,
    policy: supportedPolicy(row.policy),
  }));
  const organizationRow = records.find((row) => row.scope === "organization"),
    branch = records.find(
      (row) =>
        row.scope === "branch" &&
        row.targetKey === normalizedBranch(member.branchCode),
    ),
    student = records.find(
      (row) => row.scope === "student" && row.targetKey === member.id,
    ),
    rows = [student, branch, organizationRow],
    baseFeatures = [...coreFeatures, ...supportedFeatures(member.features)],
    activeGrants = grants.filter(
      (grant) =>
        grant.memberId === member.id &&
        (!grant.expiresAt || grant.expiresAt > new Date()),
    ),
    choose = <T extends keyof AccessPolicy>(
      key: T,
      fallback: NonNullable<AccessPolicy[T]>,
    ) => {
      const value =
        rows.find(
          (row) => row?.policy[key] !== null && row?.policy[key] !== undefined,
        )?.policy[key] ?? fallback;
      const ceiling = organizationRow?.policy[key];
      return [...new Set(value)].filter(
        (id) => !ceiling || (ceiling as string[]).includes(id),
      ) as NonNullable<AccessPolicy[T]>;
    },
    effective: EffectiveAccess = {
      features: choose("features", baseFeatures),
      courseIds: choose(
        "courseIds",
        activeGrants.map((grant) => grant.courseId),
      ),
      practiceModuleIds: choose(
        "practiceModuleIds",
        demo ? [...competitiveModules] : [],
      ),
      revision: organization.accessRevision,
      display: supportedDisplay(organization.portalDisplay),
    };
  if (!effective.features.includes("courses")) effective.courseIds = [];
  effective.practiceModuleIds = effective.practiceModuleIds.filter((id) =>
    competitiveModules.includes(id),
  );
  if (!effective.features.includes("practice"))
    effective.practiceModuleIds = [];
  if (!effective.features.includes("compiler"))
    effective.practiceModuleIds = effective.practiceModuleIds.filter(
      (id) => id !== "competitive-coding",
    );
  const source = rows.find(
    (row) =>
      row?.policy.courseIds !== null && row?.policy.courseIds !== undefined,
  );
  const versionIds = Object.fromEntries(
    effective.courseIds
      .map((id) => [
        id,
        activeGrants.find((grant) => grant.courseId === id)?.versionId ||
          source?.courseVersions[id],
      ])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  effective.courseIds = effective.courseIds.filter((id) =>
    Boolean(versionIds[id]),
  );
  return { effective, versionIds };
}

export class AccessService {
  constructor(private readonly service: SlateService) {}
  async resolve(
    tx: Transaction,
    member: MemberRecord,
    demo: boolean,
    knownOrganization?: OrganizationRecord,
  ) {
    const snapshot = await this.snapshot(tx, member, knownOrganization);
    if (!snapshot.organization) throw new NotFoundException();
    return resolvePolicies(
      snapshot.organization,
      { ...member, branchCode: snapshot.branchCode },
      snapshot.records,
      snapshot.grants,
      demo,
    );
  }
  async snapshot(
    tx: Transaction,
    member: MemberRecord,
    knownOrganization?: OrganizationRecord,
  ) {
    const branch = sql<
      string | null
    >`(select nullif(upper(btrim(${s.members.branchCode})), '') from ${s.members} where ${s.members.id} = ${member.id})`;
    const [access] = await tx
      .select({
        memberId: sql<
          string | null
        >`(select ${s.members.id} from ${s.members} where ${s.members.id} = ${member.id})`,
        branchCode: branch,
        organizations: knownOrganization
          ? sql<OrganizationRecord[]>`'[]'::jsonb`
          : jsonRows(
              getTableColumns(s.organizations),
              sql`from ${s.organizations} where ${s.organizations.id} = ${member.organizationId}`,
            ),
        records: jsonRows(
          getTableColumns(s.accessPolicies),
          sql`from ${s.accessPolicies} where ${and(
            eq(s.accessPolicies.organizationId, member.organizationId!),
            or(
              eq(s.accessPolicies.scope, "organization"),
              and(
                eq(s.accessPolicies.scope, "branch"),
                eq(s.accessPolicies.targetKey, branch),
              ),
              and(
                eq(s.accessPolicies.scope, "student"),
                eq(s.accessPolicies.targetKey, member.id),
              ),
            ),
          )}`,
        ),
        grants: jsonRows(
          getTableColumns(s.grants),
          sql`from ${s.grants} where ${s.grants.memberId} = ${member.id}`,
        ),
      })
      .from(sql`(values (true)) as access_snapshot`);
    if (!access.memberId)
      throw new NotFoundException("Student membership is no longer available.");
    return {
      organization: knownOrganization || access.organizations[0],
      branchCode: access.branchCode,
      records: access.records,
      grants: access.grants,
    };
  }
  private assertAdmin(actor: Actor) {
    if (actor.role !== "platform_admin")
      throw new ForbiddenException("Only Platform Admin can manage access.");
  }
  async workspace(
    actor: Actor,
    organizationId: string,
  ): Promise<AccessWorkspace> {
    this.assertAdmin(actor);
    return this.service.scope(actor, (tx) =>
      this.loadWorkspace(tx, organizationId),
    );
  }
  private async loadWorkspace(
    tx: Transaction,
    organizationId: string,
    known?: { organization: OrganizationRecord; records: PolicyRecord[] },
  ): Promise<AccessWorkspace> {
    const memberJson = jsonObject(getTableColumns(s.members));
    const userJson = jsonObject({ name: s.user.name, email: s.user.email });
    type Person = {
      member: MemberRecord;
      user: { name: string; email: string };
    };
    // Independent scalar subqueries avoid multiplying students by policies or
    // enrollments. RLS still runs on every table in this scoped transaction.
    const [snapshot] = await tx
      .select({
        organizations: known
          ? sql<OrganizationRecord[]>`'[]'::jsonb`
          : jsonRows(
              getTableColumns(s.organizations),
              sql`from ${s.organizations} where ${s.organizations.id} = ${organizationId}`,
            ),
        records: known
          ? sql<PolicyRecord[]>`'[]'::jsonb`
          : jsonRows(
              getTableColumns(s.accessPolicies),
              sql`from ${s.accessPolicies} where ${s.accessPolicies.organizationId} = ${organizationId}`,
            ),
        people: sql<Person[]>`(${sql`select coalesce(jsonb_agg(
          jsonb_build_object('member', ${memberJson.expression}, 'user', ${userJson.expression})
          order by ${s.user.name}), '[]'::jsonb)
          from ${s.members} inner join ${s.user} on ${s.members.authUserId} = ${s.user.id}
          where ${s.members.organizationId} = ${organizationId} and ${s.members.role} = 'student'`})`.mapWith(
          (raw: unknown) => {
            const values = (
              typeof raw === "string" ? JSON.parse(raw) : raw
            ) as {
              member: unknown;
              user: unknown;
            }[];
            return values.map((row) => ({
              member: memberJson.decode(row.member),
              user: userJson.decode(row.user),
            }));
          },
        ),
        branchCatalog: jsonRows(
          getTableColumns(s.organizationBranches),
          sql`from ${s.organizationBranches} where ${s.organizationBranches.organizationId} = ${organizationId}`,
        ),
        grants: jsonRows(
          getTableColumns(s.grants),
          sql`from ${s.grants} where ${s.grants.organizationId} = ${organizationId}`,
        ),
        courses: sql<
          AccessWorkspace["catalog"]["courses"]
        >`(${sql`select coalesce(
          jsonb_agg(jsonb_build_object('id', catalog.id, 'title', catalog.title,
            'track', catalog.track, 'version', catalog.version, 'status', catalog.status)), '[]'::jsonb)
          from (select distinct on (${s.courses.id}) ${s.courses.id}, ${s.courses.title},
            ${s.courses.track}, ${s.courses.status}, ${s.versions.number} as version
            from ${s.courses} inner join ${s.versions} on ${s.versions.courseId} = ${s.courses.id}
            where ${s.courses.status} in ('published', 'archived')
            order by ${s.courses.id}, ${s.versions.number} desc) catalog`})`,
      })
      .from(sql`(values (true)) as access_snapshot`);
    const organization = known?.organization || snapshot.organizations[0];
    if (!organization) throw new NotFoundException("Organization not found.");
    const records = (known?.records || snapshot.records).map((row) => ({
      ...row,
      policy: supportedPolicy(row.policy),
    }));
    const { people, grants, courses } = snapshot;
    const organizationPolicy = records.find(
      (row) => row.scope === "organization",
    );
    const branchPolicies = new Map(
      records
        .filter((row) => row.scope === "branch")
        .map((row) => [row.targetKey, row]),
    );
    const studentPolicies = new Map(
      records
        .filter((row) => row.scope === "student")
        .map((row) => [row.targetKey, row]),
    );
    const grantsByStudent = new Map<string, GrantRecord[]>();
    for (const grant of grants) {
      const own = grantsByStudent.get(grant.memberId) || [];
      own.push(grant);
      grantsByStudent.set(grant.memberId, own);
    }
    const branches = new Map<string, AccessWorkspace["branches"][number]>();
    for (const branch of snapshot.branchCatalog)
      branches.set(branch.code, {
        code: branch.code,
        name: branch.name,
        studentCount: 0,
        policy: branchPolicies.get(branch.code)?.policy || inheritPolicy(),
      });
    for (const { member } of people) {
      const code = normalizedBranch(member.branchCode);
      const branch = code ? branches.get(code) : undefined;
      if (branch) branch.studentCount++;
    }
    const demo =
      this.service.local &&
      !this.service.config.production &&
      demoOrganization(organization.name);
    return {
      organization: {
        id: organization.id,
        name: organization.name,
        status: organization.status,
      },
      revision: organization.accessRevision,
      organizationPolicy: organizationPolicy?.policy || inheritPolicy(),
      display: supportedDisplay(organization.portalDisplay),
      branches: [...branches.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      students: people.map(({ member, user }) => {
        const ownPolicy = studentPolicies.get(member.id);
        const ownRecords = [
          organizationPolicy,
          branchPolicies.get(normalizedBranch(member.branchCode) || ""),
          ownPolicy,
        ].filter((row): row is PolicyRecord => Boolean(row));
        const ownGrants = grantsByStudent.get(member.id) || [];
        return {
          id: member.id,
          name: user.name,
          email: user.email,
          studentId: member.studentId,
          status: member.status,
          branchName: member.branchName,
          branchCode: normalizedBranch(member.branchCode),
          cohort: member.cohort,
          policy: ownPolicy?.policy || inheritPolicy(),
          effective: resolvePolicies(
            organization,
            member,
            ownRecords,
            ownGrants,
            demo,
          ).effective,
          baseline: (() => {
            const { features, courseIds, practiceModuleIds } = resolvePolicies(
              organization,
              member,
              [],
              ownGrants,
              demo,
            ).effective;
            return { features, courseIds, practiceModuleIds };
          })(),
        };
      }),
      catalog: {
        defaults: {
          features: [...coreFeatures],
          courseIds: [],
          practiceModuleIds: demo ? [...competitiveModules] : [],
        },
        features,
        courses: courses.sort((a, b) => a.title.localeCompare(b.title)),
        practiceModules: competitiveModules.map((id) => ({
          id,
          name: "Coding",
          description:
            "DSA and coding problems with difficulty and topic filters. Requires Compiler.",
          count: demoPractice.filter((item) => item.kind === "coding").length,
          sample: true,
          requiresCompiler: id === "competitive-coding",
        })),
      },
    };
  }
  async update(
    actor: Actor,
    organizationId: string,
    raw: UpdateAccess,
  ): Promise<AccessWorkspace> {
    this.assertAdmin(actor);
    const input = updateAccessInput.parse(raw);
    return this.service.scope(actor, async (tx) => {
      await lockOrganizationBranches(tx, organizationId);
      const [organization] = await tx
        .select()
        .from(s.organizations)
        .where(eq(s.organizations.id, organizationId))
        .for("update");
      if (!organization) throw new NotFoundException("Organization not found.");
      if (organization.accessRevision !== input.revision)
        throw new ConflictException(
          "Access changed in another session. Reload and review your selections before updating.",
        );
      if (organization.status !== "active")
        throw new BadRequestException(
          "Activate the organization before updating access.",
        );
      let target = "organization";
      let member: MemberRecord | undefined;
      let selectedBranch:
        Awaited<ReturnType<typeof requireOrganizationBranch>> | undefined;
      if (input.scope === "branch") {
        target = branchCode.parse(input.targetId);
        selectedBranch = await requireOrganizationBranch(
          tx,
          organizationId,
          target,
          input.branchName,
        );
      }
      if (input.scope === "student") {
        target = z.string().uuid().parse(input.targetId);
        [member] = await tx
          .select()
          .from(s.members)
          .where(
            and(
              eq(s.members.id, target),
              eq(s.members.organizationId, organizationId),
              eq(s.members.role, "student"),
            ),
          )
          .for("update");
        if (!member)
          throw new NotFoundException(
            "Student not found in this organization.",
          );
      }
      const records = await tx
        .select()
        .from(s.accessPolicies)
        .where(eq(s.accessPolicies.organizationId, organizationId))
        .then((rows) =>
          rows.map((row) => ({
            ...row,
            policy: supportedPolicy(row.policy),
          })),
        );
      const previous = records.find(
        (row) => row.scope === input.scope && row.targetKey === target,
      );
      const ceiling = records.find(
        (row) => row.scope === "organization",
      )?.policy;
      if (input.scope !== "organization" && ceiling)
        for (const key of [
          "features",
          "courseIds",
          "practiceModuleIds",
        ] as const) {
          const blocked =
            input.policy[key]?.filter(
              (id) =>
                ceiling[key] !== null &&
                !(ceiling[key] as string[]).includes(id),
            ) || [];
          if (
            blocked.some(
              (id) => !(previous?.policy[key] as string[] | null)?.includes(id),
            )
          )
            throw new BadRequestException(
              "Selections must be allowed by the organization policy.",
            );
          if (blocked.length) {
            // A narrowed organization ceiling must not prevent unrelated edits.
            // Drop formerly valid selections when the administrator next saves this audience.
            input.policy = {
              ...input.policy,
              [key]:
                input.policy[key]?.filter((id) => !blocked.includes(id)) ??
                null,
            };
          }
        }
      // Keep earlier pins when access is removed so restoring a selection restores its progress.
      const versions: Record<string, string> = { ...previous?.courseVersions };
      if (input.policy.courseIds?.length) {
        // Lifecycle changes take an update lock on these rows. Hold share locks
        // through the save so archive and new enrollment cannot race.
        const courses = await tx
          .select({ id: s.courses.id, status: s.courses.status })
          .from(s.courses)
          .where(inArray(s.courses.id, input.policy.courseIds))
          .orderBy(s.courses.id)
          .for("share");
        const courseStatus = new Map(
          courses.map((course) => [course.id, course.status]),
        );
        const published = await tx
          .selectDistinctOn([s.courses.id], {
            course: s.courses.id,
            version: s.versions.id,
          })
          .from(s.courses)
          .innerJoin(s.versions, eq(s.versions.courseId, s.courses.id))
          .where(
            and(
              inArray(s.courses.id, input.policy.courseIds),
              eq(s.courses.status, "published"),
            ),
          )
          .orderBy(s.courses.id, desc(s.versions.number));
        const publishedVersions = new Map(
          published.map((row) => [row.course, row.version]),
        );
        for (const id of input.policy.courseIds) {
          if (courseStatus.get(id) === "archived") {
            if (
              previous?.policy.courseIds?.includes(id) &&
              previous.courseVersions[id]
            )
              continue;
            throw new BadRequestException(
              "Archived courses cannot be added to new selections. Restore the course first.",
            );
          }
          const version = publishedVersions.get(id);
          if (!version)
            throw new BadRequestException(
              "Choose published courses from the catalog.",
            );
          versions[id] = previous?.courseVersions[id] || version;
        }
      }
      const name = selectedBranch?.name || null;
      const [savedPolicy] = await tx
        .insert(s.accessPolicies)
        .values({
          organizationId,
          scope: input.scope,
          targetKey: target,
          branchName: name,
          policy: input.policy,
          courseVersions: versions,
        })
        .onConflictDoUpdate({
          target: [
            s.accessPolicies.organizationId,
            s.accessPolicies.scope,
            s.accessPolicies.targetKey,
          ],
          set: {
            policy: input.policy,
            branchName: name,
            courseVersions: versions,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (
        member &&
        input.branchCode !== undefined &&
        input.branchCode !== normalizedBranch(member.branchCode)
      ) {
        let academicName: string | null = null;
        if (input.branchCode) {
          academicName = (
            await requireOrganizationBranch(
              tx,
              organizationId,
              input.branchCode,
            )
          ).name;
        }
        await tx
          .update(s.members)
          .set({
            branchCode: input.branchCode,
            branchName: academicName,
            updatedAt: new Date(),
          })
          .where(eq(s.members.id, member.id));
      }
      const [updatedOrganization] = await tx
        .update(s.organizations)
        .set({
          accessRevision: organization.accessRevision + 1,
          ...(input.display ? { portalDisplay: input.display } : {}),
          updatedAt: new Date(),
        })
        .where(eq(s.organizations.id, organizationId))
        .returning();
      await this.service.log(
        tx,
        actor,
        `access.${input.scope}.updated`,
        organizationId,
        target,
      );
      return this.loadWorkspace(tx, organizationId, {
        organization: updatedOrganization,
        records: [
          ...records.filter((row) => row.id !== savedPolicy.id),
          savedPolicy,
        ],
      });
    });
  }
}
