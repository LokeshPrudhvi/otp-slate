import { PlacementService, placementInput } from "./placement.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService, type Actor } from "./service.js";
import { JobLogoService, companyLogoInput } from "./job-logos.js";
import {
  companyLogos,
  organizations,
  jobs,
  placementResources,
} from "./schema.js";
import { eq } from "drizzle-orm";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGLsAAAAASUVORK5CYII=";
const input = companyLogoInput.parse({
  companyName: "Example Company",
  fileName: "brand.png",
  contentType: "image/png",
  base64: png,
});
test("logos are stored once by content hash, reused across organizations and protected from student uploads", async () => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const puts: string[] = [],
    downloads: string[] = [];
  const actor = {
    id: "10000000-0000-4000-8000-000000000001",
    authId: "admin",
    role: "platform_admin",
    organizationId: null,
    features: [],
  } as unknown as Actor;
  const service = Object.create(SlateService.prototype) as SlateService;
  Object.assign(service, {
    db: connection.db,
    lessonStorage: {
      configured: () => true,
      put: async (key: string) => {
        puts.push(key);
      },
      download: async (key: string) => {
        downloads.push(key);
        return `https://storage.example.test/${key}?signed=yes`;
      },
    },
    scope: <T>(a: Actor, work: any) =>
      scoped(
        connection.db,
        {
          authId: a.authId,
          platform: a.role === "platform_admin",
          organizationId: a.organizationId,
        },
        work,
      ) as Promise<T>,
  });
  const logos = new JobLogoService(service);
  try {
    const first = await logos.create(actor, input),
      again = await logos.create(actor, {
        ...input,
        fileName: "same-brand-renamed.png",
      });
    assert.equal(first.id, again.id);
    assert.equal(first.reused, false);
    assert.equal(again.reused, true);
    assert.equal(puts.length, 1);
    assert.match(puts[0], /^company-logos\/[a-f0-9]{64}\.png$/);
    assert.equal((await logos.list(actor)).length, 1);
    const orgs = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .insert(organizations)
        .values([{ name: "Alpha" }, { name: "Beta" }])
        .returning(),
    );
    const published = await service.createJobForAll(actor, {
      title: "Graduate developer",
      company: "Example Company",
      description: "Apply to the graduate role.",
      url: "https://example.test/apply",
      logoId: first.id,
    });
    assert.equal(published.publishedCount, 2);
    assert.equal(puts.length, 1);
    const student = {
      ...actor,
      id: "10000000-0000-4000-8000-000000000002",
      authId: "student",
      role: "student",
      organizationId: orgs[0].id,
      features: ["jobs"],
    } as Actor;
    const own = await service.listJobs(student);
    assert.equal(own.length, 1);
    assert.equal(own[0].logoId, first.id);
    assert.match(own[0].companyLogoUrl!, /storage\.example\.test/);
    const second = await service.listJobs({
      ...student,
      organizationId: orgs[1].id,
    });
    assert.equal(second[0].companyLogoUrl, own[0].companyLogoUrl);
    await assert.rejects(() => logos.create(student, input), /Forbidden/);
    await assert.rejects(() => logos.list(student), /Forbidden/);
    await assert.rejects(
      () => logos.list({ ...student, role: "organization_viewer" }),
      /Forbidden/,
    );
    await assert.rejects(
      () =>
        service.createJob(actor, {
          organizationId: orgs[0].id,
          title: "Bad reference",
          company: "Example",
          description: "Not saved",
          url: "https://example.test",
          logoId: "10000000-0000-4000-8000-000000000099",
        }),
      /saved library/,
    );
    await assert.rejects(
      () =>
        scoped(connection.db, { authId: student.authId }, (tx) =>
          tx.insert(companyLogos).values({
            companyName: "No",
            companyKey: "no",
            sha256: "0".repeat(64),
            objectKey: "no",
            fileName: "n.png",
            contentType: "image/png",
            size: 1,
          }),
        ),
      (e: any) => e.cause?.code === "42501",
    );
    await scoped(connection.db, { platform: true }, (tx) =>
      tx.insert(jobs).values({
        organizationId: orgs[0].id,
        title: "Legacy job",
        company: "  EXAMPLE   COMPANY  ",
        description: "Original posting",
        url: "https://example.test/legacy",
      }),
    );
    const listed = await service.listJobs(student);
    assert.equal(
      listed.find((row) => row.title === "Legacy job")!.companyLogoUrl,
      own[0].companyLogoUrl,
    );
    downloads.length = 0;
    await service.listJobs(student);
    assert.equal(
      downloads.length,
      1,
      "Sign once per distinct logo, not once per job",
    );
    const count = await scoped(connection.db, { platform: true }, (tx) =>
      tx.select().from(companyLogos),
    );
    assert.equal(count.length, 1);
    const placement = new PlacementService(service);
    const guide = placementInput.parse({
      kind: "company",
      title: "Example Company",
      provider: "Example Company",
      logoId: first.id,
      status: "published",
      hiringProcedure: "Aptitude then interview",
      papers: [{ title: "Model paper", url: "https://example.test/paper.pdf" }],
      practiceQuestions: [
        { question: "Sample question", answer: "Sample answer" },
      ],
    });
    const saved = await placement.save(actor, guide);
    assert.equal(saved.logoId, first.id);
    assert.equal(saved.logoUrl, own[0].companyLogoUrl);
    const [stored] = await scoped(connection.db, { platform: true }, (tx) =>
      tx
        .select()
        .from(placementResources)
        .where(eq(placementResources.id, saved.id)),
    );
    assert.equal(
      stored.logoUrl,
      "",
      "Persist an asset ID, never an expiring signed URL",
    );
    const pyqStudent = { ...student, features: [...student.features, "pyq"] };
    const guides = await placement.list(pyqStudent, "company");
    assert.equal(guides[0].logoId, first.id);
    assert.equal(guides[0].logoUrl, saved.logoUrl);
    await placement.save(actor, { ...guide, status: "draft" }, saved.id);
    assert.equal((await placement.list(pyqStudent, "company")).length, 0);
    assert.equal(
      puts.length,
      1,
      "Jobs and PYQ reuse the original stored image",
    );
    await assert.rejects(
      () =>
        placement.save(actor, {
          ...guide,
          logoId: "10000000-0000-4000-8000-000000000099",
        }),
      /saved library/,
    );
  } finally {
    await connection.close();
  }
});
test("logo validation rejects disguised and oversized images before storing anything", async () => {
  const service = {
    scope: async () =>
      assert.fail("Invalid files must fail before database/storage access"),
  } as unknown as SlateService;
  const logos = new JobLogoService(service),
    actor = { role: "platform_admin" } as Actor;
  await assert.rejects(
    () => logos.create(actor, { ...input, contentType: "image/jpeg" }),
    /file type/,
  );
  await assert.rejects(
    () =>
      logos.create(actor, {
        ...input,
        base64: Buffer.from("<html>not an image</html>").toString("base64"),
      }),
    /PNG, JPEG or WebP/,
  );
  await assert.rejects(
    () =>
      logos.create(actor, {
        ...input,
        base64: Buffer.alloc(524289).toString("base64"),
      }),
    /512 KB/,
  );
});
