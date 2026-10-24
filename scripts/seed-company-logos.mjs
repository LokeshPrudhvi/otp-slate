// Explicit, idempotent logo-library seed. Does not publish unverified company training.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadConfig } from "../apps/api/dist/config.js";
import { connectDatabase, scoped } from "../apps/api/dist/database.js";
import { SlateService } from "../apps/api/dist/service.js";
import { JobLogoService } from "../apps/api/dist/job-logos.js";
import { r2LessonStorage } from "../apps/api/dist/lesson-storage.js";
import * as s from "../apps/api/dist/schema.js";
import { eq } from "drizzle-orm";
const config = loadConfig(),
  c = await connectDatabase(config.databaseUrl);
try {
  const [member] = await scoped(c.db, { platform: true }, (tx) =>
    tx
      .select()
      .from(s.members)
      .where(eq(s.members.role, "platform_admin"))
      .limit(1),
  );
  if (!member) throw new Error("A platform administrator is required.");
  const actor = {
    ...member,
    authId: member.authUserId,
    features: [],
    sessionId: "authorized-logo-library-seed",
  };
  const service = Object.assign(Object.create(SlateService.prototype), {
    db: c.db,
    config,
    local: false,
    lessonStorage: r2LessonStorage,
  });
  if (!r2LessonStorage.configured())
    throw new Error("Configured R2 storage is required.");
  const rows = JSON.parse(
    await readFile(
      new URL("../apps/api/assets/company-logos/sources.json", import.meta.url),
      "utf8",
    ),
  );
  let reused = 0,
    created = 0;
  for (const row of rows) {
    const bytes = await readFile(
      new URL(
        `../apps/api/assets/company-logos/${row.fileName}`,
        import.meta.url,
      ),
    );
    const logo = await new JobLogoService(service).create(actor, {
      companyName: row.companyName,
      fileName: row.fileName,
      contentType: "image/png",
      base64: bytes.toString("base64"),
    });
    reused += Number(logo.reused);
    const hex = createHash("sha256")
      .update(`slate-company-guide:${row.companyName}`)
      .digest("hex");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const inserted = await scoped(c.db, { platform: true }, (tx) =>
      tx
        .insert(s.placementResources)
        .values({
          id,
          kind: "company",
          title: row.companyName,
          provider: row.companyName,
          logoId: logo.id,
          status: "draft",
          description:
            "Add verified hiring details, previous-year or model papers and practice questions before publishing.",
        })
        .onConflictDoNothing({ target: s.placementResources.id })
        .returning({ id: s.placementResources.id }),
    );
    created += inserted.length;
  }
  console.log(
    `Library ready: ${rows.length} company logos (${reused} reused); ${created} new draft company guides. Existing training and job posts were preserved.`,
  );
} finally {
  await c.close();
}
