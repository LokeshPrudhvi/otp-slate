import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { crtRankings } from "./crt-rankings.js";
import { SlateService, type Actor } from "./service.js";
import * as s from "./schema.js";

test("CRT latest and overall rankings use submitted topic scores, isolate tenants and retain unranked students", async () => {
  const c = await connectDatabase("pglite://memory");
  try {
    await migrateDatabase(c.db);
    const fixture = await scoped(c.db, { platform: true }, async (tx) => {
      const orgs = await tx
        .insert(s.organizations)
        .values([{ name: "First" }, { name: "Second" }])
        .returning();
      const members = [];
      for (const [index, name] of [
        "Alice",
        "Bob",
        "No attempts",
        "Other organization",
      ].entries()) {
        const authId = randomUUID();
        await tx
          .insert(s.user)
          .values({ id: authId, name, email: `${authId}@example.test` });
        const [m] = await tx
          .insert(s.members)
          .values({
            authUserId: authId,
            organizationId: orgs[index === 3 ? 1 : 0].id,
            role: "student",
          })
          .returning();
        members.push(m);
      }
      const topics = [];
      for (let i = 0; i < 2; i++) {
        const [t] = await tx
          .insert(s.crtTopics)
          .values({ draft: {} as any, createdBy: members[0].id })
          .returning();
        const [v] = await tx
          .insert(s.crtVersions)
          .values({ topicId: t.id, number: 1, content: {} as any })
          .returning();
        topics.push({ t, v });
      }
      for (const [student, topic, score, day] of [
        [0, 0, 90, 1],
        [0, 0, 40, 3],
        [0, 1, 70, 2],
        [1, 0, 80, 1],
        [1, 1, 60, 2],
        [3, 0, 100, 4],
      ]) {
        const m = members[student],
          { t, v } = topics[topic];
        await tx
          .insert(s.crtAttempts)
          .values({
            clientId: randomUUID(),
            organizationId: m.organizationId!,
            memberId: m.id,
            kind: "topic",
            topicId: t.id,
            versionId: v.id,
            questions: [],
            passingScore: 70,
            result: { score } as any,
            submittedAt: new Date(`2026-10-0${day}T10:00:00Z`),
          });
      }
      await tx
        .insert(s.crtAttempts)
        .values({
          clientId: randomUUID(),
          organizationId: orgs[0].id,
          memberId: members[0].id,
          kind: "practice",
          questions: [],
          passingScore: 70,
          result: { score: 100 } as any,
          submittedAt: new Date("2026-10-05T10:00:00Z"),
        });
      return { orgs, members };
    });
    const service = Object.assign(Object.create(SlateService.prototype), {
      db: c.db,
    }) as SlateService;
    const actor = {
      ...fixture.members[0],
      authId: fixture.members[0].authUserId,
      features: ["crt", "rankings"],
    } as unknown as Actor;
    const latest = await crtRankings(service, actor, "latest");
    assert.deepEqual(
      latest.map((r) => [r.name, r.points, r.rank]),
      [
        ["Bob", 60, 1],
        ["Alice", 40, 2],
        ["No attempts", undefined, undefined],
      ],
    );
    const overall = await crtRankings(service, actor, "overall");
    assert.deepEqual(
      overall.map((r) => [r.name, r.points, r.rank]),
      [
        ["Alice", 80, 1],
        ["Bob", 70, 2],
        ["No attempts", undefined, undefined],
      ],
    );
    assert.ok(
      overall.every((row) =>
        Object.keys(row).every((key) =>
          ["id", "name", "points", "rank"].includes(key),
        ),
      ),
    );
    await assert.rejects(
      () => crtRankings(service, { ...actor, features: ["crt"] }, "latest"),
      /not assigned this feature/,
    );
    await assert.rejects(
      () =>
        crtRankings(
          service,
          { ...actor, role: "organization_viewer" },
          "overall",
        ),
      /Forbidden/,
    );
  } finally {
    await c.close();
  }
});
