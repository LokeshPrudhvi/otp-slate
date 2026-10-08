import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createApplication } from "./app.js";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService } from "./service.js";
import * as schema from "./schema.js";
import { seedDevelopment } from "./dev-seed.js";
import { seedDemo } from "./demo-seed.js";

// RFC 6238 authenticator, independent of the authentication library under test.
function authenticatorCode(uri: string) {
  const encoded = new URL(uri).searchParams.get("secret")!;
  const bits = [...encoded.replace(/=+$/, "")]
    .map((character) =>
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        .indexOf(character)
        .toString(2)
        .padStart(5, "0"),
    )
    .join("");
  const secret = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hash = createHmac("sha1", secret).update(counter).digest(),
    offset = hash.at(-1)! & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

test("real PostgreSQL and HTTP account, permission and learning workflows", async (t) => {
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "test-only-random-secret-32-characters-long",
    authUrl: "http://localhost:3000",
    origins: [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
    ],
    port: 0,
  };
  const auth = createAuth(connection.db, config, connection.local);
  const delivered: { phone: string; code: string }[] = [];
  const sender = {
    configured: true,
    async send(phone: string, code: string) {
      delivered.push({ phone, code });
    },
  };
  const service = new SlateService(connection.db, auth, config, sender, true);
  const root = await auth.api.createUser({
    body: {
      email: "platform@example.test",
      name: "Test Platform",
      password: "Test-only-password!A2026",
      role: "admin",
    },
  });
  await scoped(connection.db, { platform: true }, (tx) =>
    tx.insert(schema.members).values({
      authUserId: root.user.id,
      role: "platform_admin",
      passwordSetupComplete: true,
    }),
  );
  const app = await createApplication(service);
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  let browserNumber = 1;
  class Browser {
    constructor(readonly origin = config.origins[1]) {}
    // Simulate independent clients arriving through an ingress that sets client IPs.
    ip = `192.0.2.${browserNumber++}`;
    cookies = new Map<string, string>();
    async request(
      path: string,
      method = "GET",
      body?: unknown,
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: this.origin,
          "Content-Type": "application/json",
          "X-Forwarded-For": this.ip,
          ...(this.cookies.size
            ? {
                Cookie: [...this.cookies.entries()]
                  .map(([key, value]) => `${key}=${value}`)
                  .join("; "),
              }
            : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const key = pair.slice(0, index),
          value = pair.slice(index + 1);
        if (!value) this.cookies.delete(key);
        else this.cookies.set(key, value);
      }
      // Response bodies are test fixtures only, never printed into logs.
      return {
        status: response.status,
        body: (await response.json()) as Record<string, any>,
      };
    }
    async login(email: string, password: string) {
      const result = await this.request("/api/auth/sign-in/email", "POST", {
        email,
        password,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }
  }
  const platform = new Browser(),
    viewer = new Browser(),
    otherViewer = new Browser(),
    anonymous = new Browser();
  let student = new Browser();
  let orgA = "",
    orgB = "",
    memberId = "",
    courseId = "",
    lessonId = randomUUID(),
    token = "";
  let studentPassword = "";
  try {
    await t.test(
      "anonymous access and public account creation are denied",
      async () => {
        assert.equal(
          (await anonymous.request("/api/v1/platform/organizations")).status,
          401,
        );
        assert.equal(
          (
            await anonymous.request("/api/auth/sign-up/email", "POST", {
              email: "rogue@example.test",
              password: "Test-only-password!A2026",
              name: "Rogue",
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await anonymous.request("/api/auth/admin/create-user", "POST", {
              email: "rogue@example.test",
              password: "Test-only-password!A2026",
              name: "Rogue",
            })
          ).status,
          404,
        );
      },
    );
    await platform.login("platform@example.test", "Test-only-password!A2026");
    await t.test(
      "platform creates independent organizations and accounts",
      async () => {
        const a = await platform.request(
          "/api/v1/platform/organizations",
          "POST",
          { name: "Organization A" },
        );
        const b = await platform.request(
          "/api/v1/platform/organizations",
          "POST",
          { name: "Organization B" },
        );
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        orgA = a.body.id;
        orgB = b.body.id;
        const learner = await platform.request(
          "/api/v1/platform/members",
          "POST",
          {
            organizationId: orgA,
            name: "Learner A",
            email: "learner@example.test",
            role: "student",
          },
        );
        assert.equal(learner.status, 201, JSON.stringify(learner.body));
        memberId = learner.body.id;
        studentPassword = learner.body.temporaryPassword;
        await student.login("learner@example.test", studentPassword);
        for (const [organizationId, email, browser] of [
          [orgA, "viewer@example.test", viewer],
          [orgB, "other@example.test", otherViewer],
        ] as const) {
          const member = await platform.request(
            "/api/v1/platform/members",
            "POST",
            {
              organizationId,
              name: "Organization Viewer",
              email,
              role: "organization_viewer",
            },
          );
          assert.equal(member.status, 201);
          await browser.login(email, member.body.temporaryPassword);
          const update = await browser.request(
            "/api/v1/onboarding/password",
            "POST",
            {
              currentPassword: member.body.temporaryPassword,
              newPassword: "Viewer-new-password!2026",
            },
          );
          assert.equal(update.status, 201, JSON.stringify(update.body));
        }
      },
    );
    await t.test(
      "first-login steps cannot be skipped and client verification flags are rejected",
      async () => {
        const me = await student.request("/api/v1/me?portal=student");
        assert.equal(me.body.onboardingStep, "password");
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          403,
        );
        assert.equal(
          (
            await student.request("/api/v1/onboarding/phone", "POST", {
              phone: "+919876543210",
            })
          ).status,
          403,
        );
        assert.equal((await student.request("/api/auth/token")).status, 403);
        assert.equal(
          (
            await student.request("/api/v1/onboarding/password", "POST", {
              currentPassword: studentPassword,
              newPassword: "Learner-new-password!2026",
              phoneVerifiedAt: new Date().toISOString(),
            })
          ).status,
          400,
        );
        const changed = await student.request(
          "/api/v1/onboarding/password",
          "POST",
          {
            currentPassword: studentPassword,
            newPassword: "Learner-new-password!2026",
          },
        );
        assert.equal(changed.status, 201, JSON.stringify(changed.body));
        assert.equal(
          (await student.request("/api/v1/me?portal=student")).body
            .onboardingStep,
          "phone",
        );
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          403,
        );
      },
    );
    await t.test(
      "phone delivery failure stays closed; wrong codes persist attempts and correct codes are single-use",
      async () => {
        sender.configured = false;
        assert.equal(
          (
            await student.request("/api/v1/onboarding/phone", "POST", {
              phone: "+919876543210",
            })
          ).status,
          503,
        );
        sender.configured = true;
        const challenge = await student.request(
          "/api/v1/onboarding/phone",
          "POST",
          { phone: "+919876543210" },
        );
        assert.equal(challenge.status, 201, JSON.stringify(challenge.body));
        assert.equal(delivered.length, 1);
        assert.equal(
          (
            await student.request("/api/v1/onboarding/phone/verify", "POST", {
              challengeId: challenge.body.challengeId,
              code: "000000",
            })
          ).status,
          400,
        );
        const row = await scoped(
          connection.db,
          { platform: true },
          async (tx) =>
            (
              await tx
                .select()
                .from(schema.phoneChallenges)
                .where(
                  eq(schema.phoneChallenges.id, challenge.body.challengeId),
                )
            )[0],
        );
        assert.equal(row.attempts, 1);
        const accepted = await student.request(
          "/api/v1/onboarding/phone/verify",
          "POST",
          { challengeId: challenge.body.challengeId, code: delivered[0].code },
        );
        assert.equal(accepted.status, 201);
        assert.equal(accepted.body.requiresSignIn, true);
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          401,
        );
        await student.login(
          "learner@example.test",
          "Learner-new-password!2026",
        );
        assert.equal(
          (await student.request("/api/v1/me?portal=student")).body
            .onboardingStep,
          null,
        );
        assert.equal(
          (
            await student.request("/api/v1/onboarding/phone/verify", "POST", {
              challengeId: challenge.body.challengeId,
              code: delivered[0].code,
            })
          ).status,
          403,
        );
        const courses = await student.request("/api/v1/student/courses");
        assert.equal(courses.status, 200);
        assert.deepEqual(courses.body, []);
        assert.equal(
          (await student.request("/api/v1/student/resume")).status,
          403,
        );
      },
    );
    await t.test(
      "roles, request origins and organization scope are enforced on the server",
      async () => {
        assert.equal(
          (await student.request("/api/v1/platform/organizations")).status,
          403,
        );
        assert.equal(
          (await viewer.request("/api/v1/platform/organizations")).status,
          403,
        );
        assert.equal(
          (
            await viewer.request("/api/v1/platform/members", "POST", {
              organizationId: orgA,
              name: "Bad",
              email: "bad@example.test",
              role: "student",
            })
          ).status,
          403,
        );
        assert.equal(
          (await viewer.request("/api/v1/me?portal=platform")).status,
          403,
        );
        const own = await viewer.request(
          `/api/v1/organization/analytics?organizationId=${orgB}`,
        );
        assert.equal(own.status, 200, JSON.stringify(own.body));
        assert.equal(own.body.organization.id, orgA);
        assert.equal(own.body.students.length, 1);
        const other = await otherViewer.request(
          "/api/v1/organization/analytics",
        );
        assert.equal(other.body.students.length, 0);
        assert.equal(other.body.organization.id, orgB);
        assert.equal(
          (
            await platform.request(
              "/api/v1/platform/organizations",
              "POST",
              { name: "Bad origin" },
              { Origin: "https://attacker.example" },
            )
          ).status,
          403,
        );
        await assert.rejects(
          scoped(
            connection.db,
            { organizationId: orgA, readonly: true },
            (tx) =>
              tx.insert(schema.jobs).values({
                organizationId: orgA,
                title: "Denied",
                company: "Denied",
                description: "Denied",
                url: "https://example.com",
              }),
          ),
        );
        const hidden = await scoped(
          connection.db,
          { organizationId: orgB },
          (tx) =>
            tx
              .select()
              .from(schema.members)
              .where(eq(schema.members.id, memberId)),
        );
        assert.equal(hidden.length, 0);
      },
    );
    await t.test(
      "publishing a new course version does not change an existing assignment",
      async () => {
        const course = await platform.request(
          "/api/v1/platform/courses",
          "POST",
          {
            title: "Python foundations",
            description: "An authored course.",
            track: "foundation",
          },
        );
        assert.equal(course.status, 201);
        courseId = course.body.id;
        const first = await platform.request(
          `/api/v1/platform/courses/${courseId}/publish`,
          "POST",
          {
            title: "Python foundations",
            description: "An authored course.",
            lessons: [
              {
                id: lessonId,
                title: "Variables",
                body: "Original lesson content.",
              },
            ],
          },
        );
        assert.equal(first.status, 201, JSON.stringify(first.body));
        assert.equal(
          (await student.request(`/api/v1/student/courses/${courseId}`)).status,
          403,
        );
        assert.equal(
          (
            await platform.request("/api/v1/platform/assignments", "POST", {
              memberId,
              courseId,
            })
          ).status,
          201,
        );
        const second = await platform.request(
          `/api/v1/platform/courses/${courseId}/publish`,
          "POST",
          {
            title: "Python revised",
            description: "A revised course.",
            lessons: [
              {
                id: lessonId,
                title: "Variables",
                body: "Updated lesson content.",
              },
            ],
          },
        );
        assert.equal(second.body.number, 2);
        const enrolled = await student.request(
          `/api/v1/student/courses/${courseId}`,
        );
        assert.equal(enrolled.body.version, 1);
        assert.equal(enrolled.body.lessons[0].body, "Original lesson content.");
        assert.equal(
          (
            await student.request(
              `/api/v1/student/courses/${courseId}/lessons/${lessonId}/complete`,
              "POST",
              {},
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await student.request(
              `/api/v1/student/courses/${courseId}/lessons/${lessonId}/complete`,
              "POST",
              {},
            )
          ).status,
          201,
        );
        const report = await viewer.request("/api/v1/organization/analytics");
        assert.equal(report.body.totals.completedLessons, 1);
        assert.equal(report.body.students[0].completion, 100);
        assert.equal(
          (
            await platform.request("/api/v1/platform/assignments", "POST", {
              memberId,
              courseId,
            })
          ).status,
          201,
        );
        const upgraded = await student.request(
          `/api/v1/student/courses/${courseId}`,
        );
        assert.equal(upgraded.body.version, 2);
        assert.deepEqual(upgraded.body.completedLessonIds, []);
      },
    );
    await t.test(
      "database constraints reject cross-organization assignments",
      async () => {
        const version = await connection.db
          .select()
          .from(schema.versions)
          .limit(1);
        await assert.rejects(
          scoped(connection.db, { platform: true }, (tx) =>
            tx.insert(schema.grants).values({
              organizationId: orgB,
              memberId,
              courseId,
              versionId: version[0].id,
            }),
          ),
        );
      },
    );
    await t.test(
      "career tools require explicit grants, reject dangerous links and preserve resume revisions",
      async () => {
        assert.equal(
          (
            await platform.request(
              `/api/v1/platform/members/${memberId}`,
              "PATCH",
              { features: ["jobs", "resume", "rankings"] },
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await platform.request("/api/v1/platform/jobs", "POST", {
              organizationId: orgA,
              title: "Developer",
              company: "Example",
              description: "A manually published job.",
              url: "javascript:alert(1)",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await platform.request("/api/v1/platform/jobs", "POST", {
              organizationId: orgA,
              title: "Developer",
              company: "Example",
              description: "A manually published job.",
              url: "https://example.com/apply",
            })
          ).status,
          201,
        );
        const jobs = await student.request("/api/v1/student/jobs");
        assert.equal(jobs.body.length, 1);
        const resume = {
          name: "Learner A",
          title: "Developer",
          email: "learner@example.test",
          phone: "",
          summary: "My profile",
          education: "",
          experience: "",
          skills: "Python",
          projects: "",
          template: "classic",
        };
        const saved = await student.request("/api/v1/student/resume", "PUT", {
          data: resume,
          revision: 0,
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.body.revision, 1);
        const expanded = {
          ...resume,
          location: "Hyderabad",
          links: "https://example.test/profile",
          certifications: "Python fundamentals",
          template: "serif",
        };
        const changed = await student.request("/api/v1/student/resume", "PUT", {
          data: expanded,
          revision: 1,
        });
        assert.equal(changed.status, 200);
        assert.equal(changed.body.revision, 2);
        const restored = await student.request("/api/v1/student/resume");
        assert.deepEqual(restored.body.data, expanded);
        assert.equal(
          (
            await student.request("/api/v1/student/resume", "PUT", {
              data: resume,
              revision: 0,
            })
          ).status,
          409,
        );
        assert.equal(
          (await viewer.request("/api/v1/student/resume")).status,
          403,
        );
        const rankings = await student.request("/api/v1/student/rankings");
        assert.equal(rankings.body.length, 1);
        assert.deepEqual(Object.keys(rankings.body[0]).sort(), ["id", "name"]);
      },
    );
    await t.test(
      "JWTs are bound to live server sessions and logout revokes both authentication methods",
      async () => {
        const jwt = await student.request("/api/auth/token");
        assert.equal(jwt.status, 200, JSON.stringify(jwt.body));
        token = jwt.body.token;
        const bearer = await anonymous.request(
          "/api/v1/me?portal=student",
          "GET",
          undefined,
          { Authorization: `Bearer ${token}` },
        );
        assert.equal(bearer.status, 200, JSON.stringify(bearer.body));
        assert.equal(
          (await student.request("/api/auth/sign-out", "POST", {})).status,
          200,
        );
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          401,
        );
        assert.equal(
          (
            await anonymous.request(
              "/api/v1/me?portal=student",
              "GET",
              undefined,
              { Authorization: `Bearer ${token}` },
            )
          ).status,
          401,
        );
      },
    );
    await t.test(
      "password resets queue encrypted email and revoke sessions when completed",
      async () => {
        student = new Browser();
        await student.login(
          "learner@example.test",
          "Learner-new-password!2026",
        );
        const reset = await anonymous.request(
          "/api/auth/request-password-reset",
          "POST",
          {
            email: "learner@example.test",
            redirectTo: "http://localhost:5173/reset-password",
          },
        );
        assert.equal(reset.status, 200, JSON.stringify(reset.body));
        const mails = await connection.db.select().from(schema.outbox);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].status, "pending");
        assert.ok(!mails[0].encryptedPayload.includes("learner@example.test"));
        const { decryptPayload } = await import("./providers.js");
        const payload = decryptPayload(
          config.secret,
          mails[0].encryptedPayload,
        );
        const resetToken = new URL(payload.url).pathname.split("/").at(-1)!;
        const link = new URL(payload.url);
        const redirect = await fetch(base + link.pathname + link.search, {
          redirect: "manual",
        });
        assert.equal(redirect.status, 302);
        assert.ok(redirect.headers.get("location")?.includes(resetToken));
        const response = await anonymous.request(
          "/api/auth/reset-password",
          "POST",
          { token: resetToken, newPassword: "Reset-new-password!2026" },
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          401,
        );
        await student.login("learner@example.test", "Reset-new-password!2026");
      },
    );
    await t.test(
      "suspension invalidates an already active session",
      async () => {
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          200,
        );
        assert.equal(
          (
            await platform.request(
              `/api/v1/platform/members/${memberId}`,
              "PATCH",
              { status: "suspended" },
            )
          ).status,
          200,
        );
        assert.equal(
          (await student.request("/api/v1/student/courses")).status,
          401,
        );
      },
    );
    await t.test("authentication rate limits remain enabled", async () => {
      const attempts = new Browser();
      for (let i = 0; i < 3; i++)
        assert.equal(
          (
            await attempts.request("/api/auth/sign-in/email", "POST", {
              email: "missing@example.test",
              password: "Wrong-password!2026",
            })
          ).status,
          401,
        );
      assert.equal(
        (
          await attempts.request("/api/auth/sign-in/email", "POST", {
            email: "missing@example.test",
            password: "Wrong-password!2026",
          })
        ).status,
        429,
      );
    });
    await t.test(
      "production platform access requires a verified authenticator",
      async () => {
        config.production = true;
        try {
          assert.equal(
            (await platform.request("/api/v1/me?portal=platform")).body
              .onboardingStep,
            "mfa",
          );
          assert.equal(
            (await platform.request("/api/v1/platform/organizations")).status,
            403,
          );
          assert.equal((await platform.request("/api/auth/token")).status, 403);
          const enabled = await platform.request(
            "/api/auth/two-factor/enable",
            "POST",
            { password: "Test-only-password!A2026" },
          );
          assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
          assert.equal(enabled.body.method, "totp");
          assert.equal(
            (await platform.request("/api/v1/platform/organizations")).status,
            403,
          );
          const verified = await platform.request(
            "/api/auth/two-factor/verify-totp",
            "POST",
            { code: authenticatorCode(enabled.body.totpURI) },
          );
          assert.equal(verified.status, 200, JSON.stringify(verified.body));
          assert.equal(
            (await platform.request("/api/v1/platform/organizations")).status,
            200,
          );
        } finally {
          config.production = false;
        }
      },
    );
    await t.test(
      "server enforces platform idle and viewer absolute session expiry",
      async () => {
        await connection.db
          .update(schema.session)
          .set({ updatedAt: new Date(Date.now() - 16 * 60_000) })
          .where(eq(schema.session.userId, root.user.id));
        assert.equal(
          (await platform.request("/api/v1/platform/organizations")).status,
          401,
        );
        const [identity] = await connection.db
          .select()
          .from(schema.user)
          .where(eq(schema.user.email, "viewer@example.test"));
        await connection.db
          .update(schema.session)
          .set({
            createdAt: new Date(Date.now() - 9 * 3600_000),
            updatedAt: new Date(),
            expiresAt: new Date(Date.now() + 3600_000),
          })
          .where(eq(schema.session.userId, identity.id));
        assert.equal(
          (await viewer.request("/api/v1/organization/analytics")).status,
          401,
        );
      },
    );
    await t.test(
      "common local credentials create distinct student, platform and viewer sessions",
      async () => {
        await seedDevelopment(connection.db, auth);
        const portals = [
          { portal: "student", role: "student", origin: config.origins[0] },
          {
            portal: "platform",
            role: "platform_admin",
            origin: config.origins[1],
          },
          {
            portal: "organization",
            role: "organization_viewer",
            origin: config.origins[2],
          },
        ];
        const clients = [];
        for (const entry of portals) {
          const client = new Browser(entry.origin);
          await client.login("test@GMAIL.COM", "1234");
          const me = await client.request(`/api/v1/me?portal=${entry.portal}`);
          assert.equal(me.status, 200);
          assert.equal(me.body.role, entry.role);
          assert.equal(me.body.onboardingStep, null);
          for (const other of portals.filter(
            (item) => item.portal !== entry.portal,
          )) {
            assert.equal(
              (await client.request(`/api/v1/me?portal=${other.portal}`))
                .status,
              403,
            );
          }
          clients.push({ client, portal: entry.portal });
        }
        assert.equal(
          (await clients[0].client.request("/api/v1/student/courses")).status,
          200,
        );
        assert.equal(
          (await clients[1].client.request("/api/v1/platform/organizations"))
            .status,
          200,
        );
        assert.equal(
          (await clients[2].client.request("/api/v1/organization/analytics"))
            .status,
          200,
        );
        assert.equal(
          (
            await clients[2].client.request(
              "/api/v1/platform/members/" + memberId,
              "PATCH",
              { status: "suspended" },
            )
          ).status,
          403,
        );
        await clients[0].client.request("/api/auth/sign-out", "POST", {});
        assert.equal(
          (await clients[0].client.request("/api/v1/me?portal=student")).status,
          401,
        );
        // Signing out of one portal does not revoke the other portal sessions.
        assert.equal(
          (await clients[1].client.request("/api/v1/me?portal=platform"))
            .status,
          200,
        );
        assert.equal(
          (await clients[2].client.request("/api/v1/me?portal=organization"))
            .status,
          200,
        );
        for (const { client, portal } of clients.slice(1)) {
          assert.equal(
            (await client.request("/api/auth/sign-out", "POST", {})).status,
            200,
          );
          assert.equal(
            (await client.request(`/api/v1/me?portal=${portal}`)).status,
            401,
          );
        }
      },
    );
    await t.test(
      "local fixture retries share a bounded preview budget while other logins stay strict",
      async () => {
        const previews = config.origins.map((origin) => new Browser(origin));
        const sharedIp = previews[0].ip;
        for (const preview of previews) preview.ip = sharedIp;
        // Six immediate sign-ins on one IP previously exhausted the three-attempt
        // bucket when switching between the local portals.
        for (let round = 0; round < 2; round++) {
          for (const preview of previews)
            await preview.login("test@gmail.com", "1234");
        }
        await connection.db
          .update(schema.rateLimit)
          .set({ count: 30, lastRequest: Date.now() })
          .where(eq(schema.rateLimit.key, `${sharedIp}|/sign-in/email`));
        assert.equal(
          (
            await previews[0].request("/api/auth/sign-in/email", "POST", {
              email: "test@gmail.com",
              password: "1234",
            })
          ).status,
          429,
        );
        const wrongPassword = new Browser(config.origins[0]);
        for (let attempt = 0; attempt < 3; attempt++)
          assert.equal(
            (
              await wrongPassword.request("/api/auth/sign-in/email", "POST", {
                email: "test@gmail.com",
                password: "wrong-password",
              })
            ).status,
            401,
          );
        assert.equal(
          (
            await wrongPassword.request("/api/auth/sign-in/email", "POST", {
              email: "test@gmail.com",
              password: "wrong-password",
            })
          ).status,
          429,
        );
        for (const gate of ["production", "hosted"] as const) {
          const client = new Browser(config.origins[0]);
          const originalUrl = config.databaseUrl;
          config.production = gate === "production";
          if (gate === "hosted")
            config.databaseUrl = "postgresql://example.invalid/slate";
          try {
            for (let attempt = 0; attempt < 3; attempt++)
              assert.equal(
                (
                  await client.request("/api/auth/sign-in/email", "POST", {
                    email: "test@gmail.com",
                    password: "1234",
                  })
                ).status,
                401,
              );
            assert.equal(
              (
                await client.request("/api/auth/sign-in/email", "POST", {
                  email: "test@gmail.com",
                  password: "1234",
                })
              ).status,
              429,
            );
          } finally {
            config.production = false;
            config.databaseUrl = originalUrl;
          }
        }
      },
    );
    await t.test(
      "full mock seed is repeatable, tenant scoped and preserves edits and assignments",
      async () => {
        await seedDemo(connection.db, auth);
        const demoStudent = new Browser(config.origins[0]),
          demoAdmin = new Browser(config.origins[1]),
          demoViewer = new Browser(config.origins[2]);
        await demoStudent.login("test@gmail.com", "1234");
        await demoAdmin.login("test@gmail.com", "1234");
        await demoViewer.login("test@gmail.com", "1234");
        const me = await demoStudent.request("/api/v1/me?portal=student");
        assert.equal(me.body.demo, true);
        const courses = await demoStudent.request("/api/v1/student/courses");
        assert.equal(
          new Set(courses.body.map((course: any) => course.track)).size,
          6,
        );
        const practice = await demoStudent.request("/api/v1/student/practice");
        assert.equal(practice.body.length, 212);
        const coding = practice.body.filter(
          (activity: any) => activity.kind === "coding",
        );
        assert.equal(coding.length, 200);
        assert.equal(new Set(coding.map((item: any) => item.id)).size, 200);
        assert.equal(
          new Set(coding.flatMap((item: any) => item.topics)).size,
          20,
        );
        assert.deepEqual(
          new Set(coding.map((item: any) => item.difficulty)),
          new Set(["Easy", "Medium", "Hard"]),
        );
        for (const item of coding) {
          assert.ok(item.problem.statement.length > 70);
          assert.equal(Object.keys(item.problem.starterCode).length, 16);
          assert.ok(item.problem.hints.length > 0);
          for (const example of item.problem.examples) {
            assert.doesNotThrow(() => JSON.parse(example.input));
            assert.doesNotThrow(() => JSON.parse(example.output));
          }
        }
        assert.equal(
          new Set(practice.body.map((activity: any) => activity.kind)).size,
          5,
        );
        assert.ok(practice.body.every((activity: any) => activity.sample));
        const exams = await demoStudent.request("/api/v1/student/exams");
        assert.deepEqual(
          exams.body.map((exam: any) => exam.state),
          ["live", "upcoming", "completed"],
        );
        assert.equal(
          (await demoStudent.request("/api/v1/student/announcements")).body
            .length,
          4,
        );
        assert.equal(
          (await demoStudent.request("/api/v1/student/jobs")).body.length,
          6,
        );
        const rankings = await demoStudent.request("/api/v1/student/rankings");
        assert.equal(rankings.body.length, 32);
        assert.ok(
          rankings.body.every(
            (row: any, index: number) => row.sample && row.rank === index + 1,
          ),
        );
        assert.ok(
          rankings.body.every(
            (row: any, index: number) =>
              index === 0 || row.points <= rankings.body[index - 1].points,
          ),
        );
        const analytics = await demoViewer.request(
          "/api/v1/organization/analytics",
        );
        assert.equal(analytics.body.demo, true);
        assert.equal(analytics.body.students.length, 32);
        assert.equal(analytics.body.performance.results.length, 32);
        assert.equal(analytics.body.performance.trend.length, 6);
        assert.ok(
          new Set(analytics.body.students.map((row: any) => row.completion))
            .size > 5,
        );
        assert.ok(
          analytics.body.students.every(
            (row: any) => row.completedLessons <= row.totalLessons,
          ),
        );
        const resume = await demoStudent.request("/api/v1/student/resume");
        assert.ok(
          resume.body.data.summary &&
            resume.body.data.experience &&
            resume.body.data.projects,
        );
        const changedResume = {
          ...resume.body.data,
          projects: "My edited project is preserved",
        };
        await demoStudent.request("/api/v1/student/resume", "PUT", {
          data: changedResume,
          revision: resume.body.revision,
        });
        const c = courses.body.find(
          (course: any) => course.title === "C Programming Fundamentals",
        );
        const pinnedVersion = c.versionId;
        await demoAdmin.request(
          `/api/v1/platform/courses/${c.id}/publish`,
          "POST",
          {
            title: "C Programming Fundamentals — edited",
            description: "My course edit",
            lessons: [
              { title: "Edited lesson", body: "Preserve my published edit." },
            ],
          },
        );
        async function inventory() {
          return scoped(connection.db, { platform: true }, (tx) =>
            tx.execute(
              sql`SELECT (SELECT COUNT(*) FROM slate_members) AS members, (SELECT COUNT(*) FROM slate_courses) AS courses, (SELECT COUNT(*) FROM slate_course_versions) AS versions, (SELECT COUNT(*) FROM slate_grants) AS grants, (SELECT COUNT(*) FROM slate_progress) AS progress, (SELECT COUNT(*) FROM slate_jobs) AS jobs, (SELECT COUNT(*) FROM slate_resumes) AS resumes`,
            ),
          );
        }
        const before = await inventory();
        await seedDemo(connection.db, auth);
        assert.deepEqual((await inventory()).rows, before.rows);
        assert.equal(
          (await demoStudent.request(`/api/v1/student/courses/${c.id}`)).body
            .versionId,
          pinnedVersion,
        );
        assert.deepEqual(
          (await demoStudent.request("/api/v1/student/resume")).body.data,
          changedResume,
        );
        const ordinaryUser = await auth.api.createUser({
          body: {
            email: "ordinary-student@example.test",
            name: "Ordinary Student",
            password: "Normal-test-password!2026",
            role: "user",
          },
        });
        await scoped(connection.db, { platform: true }, (tx) =>
          tx.insert(schema.members).values({
            authUserId: ordinaryUser.user.id,
            organizationId: orgA,
            role: "student",
            passwordSetupComplete: true,
            phoneVerifiedAt: new Date(),
            features: ["rankings"],
          }),
        );
        const ordinary = new Browser(config.origins[0]);
        await ordinary.login(
          "ordinary-student@example.test",
          "Normal-test-password!2026",
        );
        assert.equal(
          (await ordinary.request("/api/v1/me?portal=student")).body.demo,
          false,
        );
        assert.deepEqual(
          (await ordinary.request("/api/v1/student/practice")).body,
          [],
        );
        assert.deepEqual(
          (await ordinary.request("/api/v1/student/exams")).body,
          [],
        );
        assert.ok(
          (await ordinary.request("/api/v1/student/rankings")).body.every(
            (row: any) => !row.sample && row.points === undefined,
          ),
        );
        assert.equal(
          (
            await demoAdmin.request(
              `/api/v1/platform/demo-preview?organizationId=${orgA}`,
            )
          ).body.sample,
          false,
        );
        config.production = true;
        try {
          assert.deepEqual(
            (await demoStudent.request("/api/v1/student/practice")).body,
            [],
          );
        } finally {
          config.production = false;
        }
      },
    );
    await t.test(
      "common credentials reject wrong passwords and unrecognized portal origins",
      async () => {
        assert.equal(
          (
            await new Browser(config.origins[0]).request(
              "/api/auth/sign-in/email",
              "POST",
              { email: "test@gmail.com", password: "1235" },
            )
          ).status,
          401,
        );
        assert.notEqual(
          (
            await new Browser("http://unrecognized.localhost:5173").request(
              "/api/auth/sign-in/email",
              "POST",
              { email: "test@gmail.com", password: "1234" },
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "common credentials are unavailable in production and nonlocal database configurations",
      async () => {
        config.production = true;
        try {
          assert.equal(
            (
              await new Browser(config.origins[0]).request(
                "/api/auth/sign-in/email",
                "POST",
                { email: "test@gmail.com", password: "1234" },
              )
            ).status,
            401,
          );
        } finally {
          config.production = false;
        }
        const url = config.databaseUrl;
        config.databaseUrl = "postgresql://example.invalid/slate";
        try {
          assert.equal(
            (
              await new Browser(config.origins[0]).request(
                "/api/auth/sign-in/email",
                "POST",
                { email: "test@gmail.com", password: "1234" },
              )
            ).status,
            401,
          );
        } finally {
          config.databaseUrl = url;
        }
        // Even a development-looking URL cannot enable the alias without an
        // actual local connection supplied by the runtime.
        const nonlocalAuth = createAuth(connection.db, config, false);
        await assert.rejects(() =>
          nonlocalAuth.api.signInEmail({
            body: { email: "test@gmail.com", password: "1234" },
            headers: new Headers({ origin: config.origins[0] }),
          }),
        );
      },
    );
  } finally {
    await app.close();
    await connection.close();
  }
});
