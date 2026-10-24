// Explicitly publish only the 14 seeded company guides, retaining their shared logo IDs.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { loadConfig } from "../apps/api/dist/config.js";
import { connectDatabase, scoped } from "../apps/api/dist/database.js";
import { SlateService } from "../apps/api/dist/service.js";
import {
  PlacementService,
  placementInput,
} from "../apps/api/dist/placement.js";
import { placementSamplePath } from "../apps/api/dist/placement-samples.js";
import { r2LessonStorage } from "../apps/api/dist/lesson-storage.js";
import * as s from "../apps/api/dist/schema.js";
const config = loadConfig(),
  c = await connectDatabase(config.databaseUrl);
try {
  const content = JSON.parse(
    await readFile(
      new URL("./company-pyq-mock-content.json", import.meta.url),
      "utf8",
    ),
  );
  const ids = content.map((row) => {
    const h = createHash("sha256")
      .update(`slate-company-guide:${row.companyName}`)
      .digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
  });
  const context = await scoped(c.db, { platform: true }, async (tx) => ({
    admin: (
      await tx
        .select()
        .from(s.members)
        .where(eq(s.members.role, "platform_admin"))
        .limit(1)
    )[0],
    guides: await tx
      .select()
      .from(s.placementResources)
      .where(inArray(s.placementResources.id, ids)),
  }));
  if (!context.admin || context.guides.length !== 14)
    throw new Error(
      "The platform administrator and all 14 seeded company guides are required.",
    );
  const inputs = await Promise.all(
    content.map(async (row, i) => {
      const current = context.guides.find((item) => item.id === ids[i]);
      if (!current?.logoId || current.title !== row.companyName)
        throw new Error(`Guide preflight failed: ${row.companyName}`);
      const bytes = await readFile(
        placementSamplePath(`${row.slug}-model-paper.pdf`),
      );
      if (bytes.subarray(0, 5).toString() !== "%PDF-")
        throw new Error("Model PDF missing.");
      return placementInput.parse({
        kind: "company",
        title: current.title,
        provider: current.provider,
        logoId: current.logoId,
        logoUrl: "",
        url: "",
        description: row.description,
        hiringProcedure: row.hiringProcedure,
        papers: row.papers,
        practiceQuestions: row.practiceQuestions,
        status: "published",
      });
    }),
  );
  const actor = {
    ...context.admin,
    authId: context.admin.authUserId,
    features: [],
    sessionId: "authorized-mock-guide-publication",
  };
  const service = Object.assign(Object.create(SlateService.prototype), {
    db: c.db,
    config,
    local: false,
    lessonStorage: r2LessonStorage,
  });
  for (let i = 0; i < inputs.length; i++) {
    await new PlacementService(service).save(actor, inputs[i], ids[i]);
    console.log(`Published mock guide: ${inputs[i].title}`);
  }
  const visible = await new PlacementService(service).list(
    { ...actor, role: "student", features: ["pyq"] },
    "company",
  );
  const found = visible.filter((item) => ids.includes(item.id));
  if (
    found.length !== 14 ||
    found.some(
      (item) =>
        !item.logoUrl ||
        item.papers.length !== 1 ||
        item.practiceQuestions.length !== 5,
    )
  )
    throw new Error("Published guide verification failed.");
  console.log(
    "Verified all 14 company guides in the student catalogue, with 14 model papers and 70 practice questions. Existing logos and other guides were preserved.",
  );
} finally {
  await c.close();
}
