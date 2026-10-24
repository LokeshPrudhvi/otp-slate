import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { CompanyLogo } from "@slate/contracts";
import type { Actor, SlateService } from "./service.js";
import type { Transaction } from "./database.js";
import { companyLogos } from "./schema.js";
export const companyLogoInput = z
  .object({
    companyName: z.string().trim().min(1).max(150),
    fileName: z.string().trim().min(1).max(180),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    base64: z
      .string()
      .min(16)
      .max(699052)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
export const companyKey = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
function imageType(bytes: Buffer) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  throw new BadRequestException("Choose a PNG, JPEG or WebP image.");
}
type LogoRow = typeof companyLogos.$inferSelect;
export class JobLogoService {
  constructor(private service: SlateService) {}
  private async view(row: LogoRow): Promise<CompanyLogo> {
    return {
      id: row.id,
      companyName: row.companyName,
      sha256: row.sha256,
      fileName: row.fileName,
      url: this.service.lessonStorage.configured()
        ? await this.service.lessonStorage.download(
            row.objectKey,
            row.fileName,
            false,
          )
        : null,
    };
  }
  async list(actor: Actor) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    const rows = await this.service.scope(actor, (tx) =>
      tx.select().from(companyLogos).orderBy(desc(companyLogos.createdAt)),
    );
    return Promise.all(rows.map((row) => this.view(row)));
  }
  async create(actor: Actor, input: z.infer<typeof companyLogoInput>) {
    if (actor.role !== "platform_admin") throw new ForbiddenException();
    const bytes = Buffer.from(input.base64, "base64");
    if (
      !bytes.length ||
      bytes.length > 524288 ||
      bytes.toString("base64") !== input.base64
    )
      throw new BadRequestException("Choose an image of 512 KB or smaller.");
    const type = imageType(bytes);
    if (type !== input.contentType)
      throw new BadRequestException(
        "The image contents do not match its file type.",
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return this.service.scope(actor, async (tx) => {
      const [existing] = await tx
        .select()
        .from(companyLogos)
        .where(eq(companyLogos.sha256, sha256));
      if (existing) return { ...(await this.view(existing)), reused: true };
      if (
        !this.service.lessonStorage.configured() ||
        !this.service.lessonStorage.put
      )
        throw new ServiceUnavailableException(
          "Logo storage is not configured. Select a saved logo or ask the platform administrator to connect storage.",
        );
      const extension =
          type === "image/png" ? "png" : type === "image/jpeg" ? "jpg" : "webp",
        objectKey = `company-logos/${sha256}.${extension}`;
      // Hash-based immutable keys mean even simultaneous uploads cannot create duplicate objects.
      await this.service.lessonStorage.put(objectKey, bytes, type);
      const [inserted] = await tx
        .insert(companyLogos)
        .values({
          companyName: input.companyName,
          companyKey: companyKey(input.companyName),
          sha256,
          objectKey,
          fileName: input.fileName,
          contentType: type,
          size: bytes.length,
        })
        .onConflictDoNothing({ target: companyLogos.sha256 })
        .returning();
      const row =
        inserted ??
        (
          await tx
            .select()
            .from(companyLogos)
            .where(eq(companyLogos.sha256, sha256))
        )[0];
      await this.service.log(tx, actor, "company-logo.created", null, row.id);
      return { ...(await this.view(row)), reused: !inserted };
    });
  }
  async validate(tx: Transaction, id?: string | null) {
    if (!id) return;
    const [logo] = await tx
      .select({ id: companyLogos.id })
      .from(companyLogos)
      .where(eq(companyLogos.id, id));
    if (!logo)
      throw new NotFoundException(
        "Choose a company logo from the saved library.",
      );
  }
  async resolve<T extends { company: string; logoId: string | null }>(
    tx: Transaction,
    jobs: T[],
  ) {
    if (!jobs.length) return [] as (T & { companyLogoUrl: string | null })[];
    const ids = [
      ...new Set(jobs.flatMap((job) => (job.logoId ? [job.logoId] : []))),
    ];
    const keys = [
      ...new Set(
        jobs.filter((job) => !job.logoId).map((job) => companyKey(job.company)),
      ),
    ];
    const rows = await tx
      .select()
      .from(companyLogos)
      .where(
        or(
          ids.length ? inArray(companyLogos.id, ids) : undefined,
          keys.length ? inArray(companyLogos.companyKey, keys) : undefined,
        ),
      )
      .orderBy(desc(companyLogos.createdAt));
    const byId = new Map(rows.map((row) => [row.id, row])),
      byCompany = new Map<string, LogoRow>();
    for (const row of rows)
      if (!byCompany.has(row.companyKey)) byCompany.set(row.companyKey, row);
    const chosen = jobs.map((job) =>
      job.logoId
        ? byId.get(job.logoId)
        : byCompany.get(companyKey(job.company)),
    );
    const urls = new Map<string, string | null>();
    await Promise.all(
      [
        ...new Map(
          chosen
            .filter((row): row is LogoRow => Boolean(row))
            .map((row) => [row.id, row]),
        ).values(),
      ].map(async (row) => urls.set(row.id, (await this.view(row)).url)),
    );
    return jobs.map((job, i) => ({
      ...job,
      companyLogoUrl: chosen[i] ? (urls.get(chosen[i]!.id) ?? null) : null,
    }));
  }
}
