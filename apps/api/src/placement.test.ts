import { test } from "node:test";
import assert from "node:assert/strict";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { PlacementService, placementInput } from "./placement.js";
import { SlateService, type Actor } from "./service.js";
import { codingCatalog } from "./coding-catalog.js";
import { placementResources } from "./schema.js";

test("400 added coding exercises have the requested split, stable IDs and valid reproducible examples", () => {
  assert.equal(codingCatalog.length, 600);
  assert.equal(new Set(codingCatalog.map((p) => p.id)).size, 600);
  const added = codingCatalog.filter((p) => p.number! > 200);
  assert.deepEqual(
    ["Easy", "Medium", "Hard"].map(
      (d) => added.filter((p) => p.difficulty === d).length,
    ),
    [240, 100, 60],
  );
  assert.equal(new Set(codingCatalog.map((p) => p.number)).size, 600);
  for (const p of added) {
    assert.ok(p.problem!.testCases!.length >= 3);
    for (const row of p.problem!.testCases!) {
      JSON.parse(row.input);
      JSON.parse(row.output);
    }
    assert.equal(Object.keys(p.problem!.starterCode).length, 16);
    assert.ok(p.problem!.hints!.length);
  }
  const specimen = codingCatalog.find((p) => p.id === "cp-201")!;
  assert.equal(specimen.problem!.examples[0].output, "17");
});

test("placement input prevents unsafe URLs and incomplete published company training", () => {
  const base = {
    kind: "company",
    title: "Acme",
    provider: "Acme",
    status: "published",
  };
  assert.equal(placementInput.safeParse(base).success, false);
  assert.equal(
    placementInput.safeParse({ ...base, status: "draft" }).success,
    true,
  );
  for (const url of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:secret@example.com",
  ])
    assert.equal(
      placementInput.safeParse({
        kind: "certification",
        title: "Course",
        provider: "Provider",
        status: "published",
        url,
      }).success,
      false,
    );
  assert.equal(
    placementInput.safeParse({
      kind: "certification",
      title: "Course",
      provider: "Provider",
      status: "published",
      url: "https://example.com/course",
    }).success,
    true,
  );
});

test("only platform admin can publish; students see published resources only and need the right feature", async () => {
  const conn = await connectDatabase("pglite://memory");
  try {
    await migrateDatabase(conn.db);
    const platform = {
      role: "platform_admin",
      authId: "admin",
      features: [],
      id: "10000000-0000-4000-8000-000000000001",
    } as unknown as Actor;
    const student = {
      role: "student",
      authId: "student",
      features: ["jobs", "pyq"],
      id: "10000000-0000-4000-8000-000000000002",
    } as unknown as Actor;
    const service = {
      db: conn.db,
      scope: <T>(actor: Actor, work: any) =>
        scoped(
          conn.db,
          { authId: actor.authId, platform: actor.role === "platform_admin" },
          work,
        ) as Promise<T>,
      feature: SlateService.prototype.feature,
      log: async () => {},
    } as unknown as SlateService;
    const placement = new PlacementService(service);
    const draft = placementInput.parse({
      kind: "certification",
      title: "Draft",
      provider: "Provider",
      status: "draft",
    });
    const published = placementInput.parse({
      ...draft,
      title: "Live",
      status: "published",
      url: "https://example.com/course",
    });
    await placement.save(platform, draft);
    const item = await placement.save(platform, published);
    assert.equal((await placement.list(platform, "certification")).length, 2);
    assert.equal((await placement.list(student, "certification")).length, 1);
    await assert.rejects(() => placement.save(student, published), /Forbidden/);
    await assert.rejects(
      () => placement.list({ ...student, features: [] }, "certification"),
      /not assigned/,
    );
    await assert.rejects(
      () => placement.list({ ...student, features: ["jobs"] }, "company"),
      /not assigned/,
    );
    await scoped(conn.db, { authId: "student" }, async (tx) => {
      assert.equal((await tx.select().from(placementResources)).length, 1);
    });
    await assert.rejects(
      () =>
        scoped(conn.db, { authId: "student" }, (tx) =>
          tx
            .insert(placementResources)
            .values({ ...published, title: "Unauthorized" }),
        ),
      (error: unknown) =>
        (error as { cause?: { code?: string } }).cause?.code === "42501",
    );
    await placement.save(
      platform,
      { ...published, status: "archived" },
      item.id,
    );
    assert.equal((await placement.list(student, "certification")).length, 0);
  } finally {
    await conn.close();
  }
});

test("bundled mock papers and logos are valid resources; arbitrary local paths cannot be published or served", async () => {
  const { placementSamplePath } = await import("./placement-samples.js");
  const { readFile } = await import("node:fs/promises");
  const rows = JSON.parse(
    await readFile(
      new URL("../../../scripts/pyq-mock-data.json", import.meta.url),
      "utf8",
    ),
  );
  for (const row of rows) {
    assert.equal(placementInput.safeParse(row).success, true);
    const file = row.papers[0].url.split("/").pop();
    const pdf = await readFile(placementSamplePath(file));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const logo = await readFile(
      placementSamplePath(row.logoUrl.split("/").pop()),
      "utf8",
    );
    assert.match(logo, /<svg/);
  }
  for (const file of [
    "../../.env",
    "%2e%2e%2f.env",
    "unknown.pdf",
    "northstar-tech.svg/../../.env",
  ])
    assert.throws(() => placementSamplePath(file));
  for (const url of [
    "/api/v1/platform/members",
    "//evil.example/paper.pdf",
    "/samples/unknown.pdf",
    "/api/v1/placement-samples/../../.env",
  ]) {
    assert.equal(
      placementInput.safeParse({
        ...rows[0],
        papers: [{ title: "Unsafe local path", url }],
      }).success,
      false,
    );
  }
});

test("all 14 branded mock guides have complete publishable content and bundled model PDFs", async () => {
  const { readFile } = await import("node:fs/promises");
  const { placementSamplePath, isPlacementSampleUrl } =
    await import("./placement-samples.js");
  const rows = JSON.parse(
    await readFile(
      new URL(
        "../../../scripts/company-pyq-mock-content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(rows.length, 14);
  assert.equal(new Set(rows.map((row: any) => row.companyName)).size, 14);
  for (const row of rows) {
    const input = {
      kind: "company",
      title: row.companyName,
      provider: row.companyName,
      logoId: "10000000-0000-4000-8000-000000000001",
      description: row.description,
      hiringProcedure: row.hiringProcedure,
      papers: row.papers,
      practiceQuestions: row.practiceQuestions,
      status: "published",
    };
    assert.equal(
      placementInput.safeParse(input).success,
      true,
      row.companyName,
    );
    assert.match(row.hiringProcedure, /MOCK HIRING PROCEDURE/);
    assert.match(row.description, /Not an official/);
    assert.equal(row.practiceQuestions.length, 5);
    assert.ok(row.practiceQuestions.every((q: any) => q.question && q.answer));
    const path = row.papers[0].url;
    assert.equal(isPlacementSampleUrl(path), true);
    const pdf = await readFile(placementSamplePath(path.split("/").pop()));
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  }
  assert.equal(
    isPlacementSampleUrl("/api/v1/placement-samples/google.svg"),
    false,
  );
  assert.equal(
    isPlacementSampleUrl(
      "/api/v1/placement-samples/google-model-paper.pdf/../../.env",
    ),
    false,
  );
});
