import { JobLogoService } from "./job-logos.js";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Actor, SlateService } from "./service.js";
import { placementResources } from "./schema.js";
import { isPlacementSampleUrl } from "./placement-samples.js";
const link = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Use a valid HTTPS link.");
const resourceLink = z.union([
  link,
  z
    .string()
    .refine(isPlacementSampleUrl, "Use an HTTPS link or a bundled PYQ sample."),
]);
export const placementInput = z
  .object({
    kind: z.enum(["certification", "company"]),
    title: z.string().trim().min(1).max(180),
    provider: z.string().trim().min(1).max(150),
    description: z.string().trim().max(5000).default(""),
    logoId: z.string().uuid().nullable().optional(),
    logoUrl: z.union([z.literal(""), resourceLink]).default(""),
    url: z.union([z.literal(""), link]).default(""),
    hiringProcedure: z.string().trim().max(12000).default(""),
    papers: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            url: resourceLink,
          })
          .strict(),
      )
      .max(100)
      .default([]),
    practiceQuestions: z
      .array(
        z
          .object({
            question: z.string().trim().min(1).max(4000),
            answer: z.string().trim().max(8000),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    status: z.enum(["draft", "published", "archived"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status !== "published") return;
    if (value.kind === "certification" && !value.url)
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Add the provider's course link before publishing.",
      });
    if (
      value.kind === "company" &&
      ((!value.logoUrl && !value.logoId) ||
        !value.hiringProcedure ||
        !value.papers.length ||
        !value.practiceQuestions.length)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Published company training needs a logo, hiring procedure, a paper link and practice questions.",
      });
  });
export class PlacementService {
  constructor(private service: SlateService) {}
  async list(actor: Actor, kind: "certification" | "company") {
    if (actor.role !== "platform_admin") {
      if (actor.role !== "student") throw new ForbiddenException();
      this.service.feature(actor, kind === "company" ? "pyq" : "jobs");
    }
    return this.service.scope(actor, async (tx) => {
      const rows = await tx
        .select()
        .from(placementResources)
        .where(
          and(
            eq(placementResources.kind, kind),
            actor.role === "platform_admin"
              ? undefined
              : eq(placementResources.status, "published"),
          ),
        )
        .orderBy(desc(placementResources.updatedAt));
      return this.resolveLogos(tx, rows);
    });
  }
  async save(actor: Actor, input: z.infer<typeof placementInput>, id?: string) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    return this.service.scope(actor, async (tx) => {
      await new JobLogoService(this.service).validate(tx, input.logoId);
      const values = {
        ...input,
        logoUrl: input.logoId ? "" : input.logoUrl,
        updatedAt: new Date(),
      };
      const [resource] = id
        ? await tx
            .update(placementResources)
            .set(values)
            .where(
              and(
                eq(placementResources.id, id),
                eq(placementResources.kind, input.kind),
              ),
            )
            .returning()
        : await tx.insert(placementResources).values(values).returning();
      if (!resource) throw new NotFoundException("Resource not found.");
      await this.service.log(
        tx,
        actor,
        "placement." + input.status,
        null,
        resource.id,
      );
      return (await this.resolveLogos(tx, [resource]))[0];
    });
  }
  private async resolveLogos(
    tx: import("./database.js").Transaction,
    rows: (typeof placementResources.$inferSelect)[],
  ) {
    const resolved = await new JobLogoService(this.service).resolve(
      tx,
      rows.map((row) => ({
        ...row,
        company: row.kind === "company" ? row.title : row.provider,
      })),
    );
    return resolved.map(({ company, companyLogoUrl, ...row }) => ({
      ...row,
      logoUrl: companyLogoUrl || row.logoUrl,
    }));
  }
}
