import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createAuth } from "./auth.js";
import { connectDatabase, migrateDatabase, scoped } from "./database.js";
import { SlateService, type Actor } from "./service.js";
import {
  RegistrationService,
  registrationInput,
  registrationRequests,
} from "./registration.js";
import { decryptPayload } from "./providers.js";
import type { Request } from "express";
import * as s from "./schema.js";

test("registration staging, approval and encrypted welcome mail are atomic and access-controlled", async (t) => {
  const previousPortal = process.env.STUDENT_PORTAL_URL;
  process.env.STUDENT_PORTAL_URL = "http://localhost:5173";
  t.after(() => {
    if (previousPortal === undefined) delete process.env.STUDENT_PORTAL_URL;
    else process.env.STUDENT_PORTAL_URL = previousPortal;
  });
  const connection = await connectDatabase("pglite://memory");
  await migrateDatabase(connection.db);
  const config = {
    production: false,
    databaseUrl: "pglite://memory",
    migrationUrl: undefined,
    secret: "registration-test-secret-32-characters-long",
    authUrl: "http://localhost:3000",
    origins: ["http://localhost:5173"],
    port: 0,
  };
  const auth = createAuth(connection.db, config, true);
  const service = new SlateService(
    connection.db,
    auth,
    config,
    true,
  );
  const registration = new RegistrationService(service);
  const owner = await auth.api.createUser({
    body: {
      email: "registration-admin@example.test",
      name: "Registration Admin",
      password: "Testing-admin-password!2026",
      role: "admin",
    },
  });
  const { platformId, organizationId, archivedId } = await scoped(
    connection.db,
    { platform: true },
    async (tx) => {
      const [member] = await tx
        .insert(s.members)
        .values({
          authUserId: owner.user.id,
          role: "platform_admin",
          passwordSetupComplete: true,
        })
        .returning();
      const [organization] = await tx
        .insert(s.organizations)
        .values({ name: "Registration College" })
        .returning();
      await tx.insert(s.organizationBranches).values({ organizationId: organization.id, code: "CSE", name: "Computer Science" });
      const [archived] = await tx
        .insert(s.organizations)
        .values({ name: "Archived College", status: "archived" })
        .returning();
      return {
        platformId: member.id,
        organizationId: organization.id,
        archivedId: archived.id,
      };
    },
  );
  const actor: Actor = {
    id: platformId,
    authId: owner.user.id,
    sessionId: randomUUID(),
    name: "Registration Admin",
    email: "registration-admin@example.test",
    role: "platform_admin",
    organizationId: null,
    organizationName: null,
    onboardingStep: null,
    features: [],
  };
  const input = (number: number) =>
    registrationInput.parse({
      organizationId,
      studentId: `ROLL-${number}`,
      name: `Student ${number}`,
      email: `student${number}@registration.example.test`,
      phone: "9876543210",
      cohort: "2026",
      branchName: "Computer Science",
      branchCode: "cse",
    });
  const dbCounts = async () => ({
    users: (await connection.db.select().from(s.user)).length,
    members: (
      await scoped(connection.db, { platform: true }, (tx) =>
        tx.select().from(s.members),
      )
    ).length,
    outbox: (await connection.db.select().from(s.outbox)).length,
  });
  try {
    await t.test(
      "catalog exposes active names and IDs only; strict input rejects access or password injection",
      async () => {
        assert.deepEqual(await registration.organizations(), [
          { id: organizationId, name: "Registration College" },
        ]);
        assert.equal(input(1).phone, "+919876543210");
        assert.equal(input(1).branchCode, "CSE");
        for (const extra of [
          { role: "platform_admin" },
          { password: "Anything123!" },
          { features: ["jobs"] },
          { status: "active" },
        ])
          assert.equal(
            registrationInput.safeParse({ ...input(1), ...extra }).success,
            false,
          );
        assert.equal(
          registrationInput.safeParse({ ...input(1), branchCode: "<script>" })
            .success,
          false,
        );
        assert.equal(
          registrationInput.safeParse({ ...input(1), phone: "1234567890" })
            .success,
          false,
        );
        await assert.rejects(
          () =>
            registration.submit(
              { ...input(1), organizationId: archivedId },
              "archive-client",
            ),
          /active organization/,
        );
      },
    );
    let firstId = "";
    await t.test(
      "public registration creates only a pending request, with duplicate guards",
      async () => {
        const before = await dbCounts();
        const receipt = await registration.submit(input(1), "first-client");
        firstId = receipt.id;
        assert.deepEqual(Object.keys(receipt).sort(), ["id", "status"]);
        assert.equal(receipt.status, "pending");
        assert.deepEqual(await dbCounts(), before);
        await assert.rejects(
          () =>
            registration.submit(
              { ...input(2), email: input(1).email },
              "email-duplicate",
            ),
          /already exists/,
        );
        await assert.rejects(
          () =>
            registration.submit(
              { ...input(2), studentId: "roll-1" },
              "id-duplicate",
            ),
          /already exists/,
        );
        await assert.rejects(
          () =>
            registration.submit(
              { ...input(2), email: actor.email },
              "existing-email",
            ),
          /already exists/,
        );
        await assert.rejects(
          () =>
            scoped(connection.db, { organizationId }, async (tx) => {
              await tx.execute(sql`SET LOCAL ROLE slate_registration`);
              await tx.execute(sql`select email from registration_requests`);
            }),
          (error) =>
            (error as { cause?: { code?: string } }).cause?.code === "42501",
        );
        await assert.rejects(
          () =>
            scoped(connection.db, { organizationId }, async (tx) => {
              await tx.execute(sql`SET LOCAL ROLE slate_registration`);
              await tx.update(s.members).set({ role: "platform_admin" });
            }),
          (error) =>
            (error as { cause?: { code?: string } }).cause?.code === "42501",
        );
      },
    );
    await t.test(
      "viewers cannot review and approval creates one student and one encrypted welcome email",
      async () => {
        const viewer = {
          ...actor,
          role: "organization_viewer" as const,
          organizationId,
        };
        await assert.rejects(
          () => registration.approve(viewer, [firstId]),
          /Only Platform Admin/,
        );
        await assert.rejects(
          () => registration.reject(viewer, firstId, "No"),
          /Only Platform Admin/,
        );
        await assert.rejects(
          () => registration.import(viewer, organizationId, [input(2)]),
          /Only Platform Admin/,
        );
        const before = await dbCounts();
        const approvals = await Promise.all([
          registration.approve(actor, [firstId]),
          registration.approve(actor, [firstId]),
        ]);
        assert.deepEqual(
          approvals.map((result) => result.results[0].status).sort(),
          ["already_approved", "approved"],
        );
        const after = await dbCounts();
        assert.deepEqual(after, {
          users: before.users + 1,
          members: before.members + 1,
          outbox: before.outbox + 1,
        });
        assert.ok(!JSON.stringify(approvals).includes("password"));
        const [request] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.id, firstId)),
        );
        const [member] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(s.members)
            .where(eq(s.members.id, request.memberId!)),
        );
        assert.equal(member.role, "student");
        assert.equal(member.studentId, "ROLL-1");
        assert.equal(member.branchCode, "CSE");
        assert.equal(member.passwordSetupComplete, false);
        assert.equal(member.phoneVerifiedAt, null);
        assert.deepEqual(member.features, []);
        const [mail] = await connection.db
          .select()
          .from(s.outbox)
          .where(eq(s.outbox.id, request.welcomeOutboxId!));
        assert.equal(mail.type, "welcome_student");
        assert.equal(mail.status, "pending");
        assert.ok(!mail.encryptedPayload.includes(input(1).email));
        const payload = decryptPayload(
          config.secret,
          mail.encryptedPayload,
          "welcome_student",
        );
        assert.equal(payload.email, input(1).email);
        assert.ok(payload.temporaryPassword.length >= 32);
        const signedIn = await auth.api.signInEmail({
          body: { email: payload.email, password: payload.temporaryPassword },
        });
        assert.equal(signedIn.user.id, member.authUserId);
        const signInResponse = await auth.api.signInEmail({
          body: { email: payload.email, password: payload.temporaryPassword },
          asResponse: true,
        });
        const cookie = signInResponse.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
        const requestWithSession = { headers: { cookie } } as Request;
        const onboarding = await service.actor(
          requestWithSession,
          "student",
          true,
        );
        assert.equal(onboarding.onboardingStep, "password");
        await assert.rejects(
          () => service.actor(requestWithSession, "student"),
          /Complete your account setup/,
        );
        const grants = await service.scope(actor, (tx) =>
          tx.select().from(s.grants).where(eq(s.grants.memberId, member.id)),
        );
        assert.deepEqual(grants, []);
        const listed = await registration.list(
          actor,
          organizationId,
          "approved",
        );
        assert.equal(listed[0].emailStatus, "pending");
        assert.equal(listed[0].organizationName, "Registration College");
        assert.ok(!JSON.stringify(listed).includes(payload.temporaryPassword));
        await assert.rejects(
          () => registration.reject(actor, firstId, "Later rejection"),
          /approved registration/,
        );
        await assert.rejects(
          () =>
            registration.submit(
              { ...input(2), studentId: "ROLL-1" },
              "member-duplicate",
            ),
          /already exists/,
        );
      },
    );
    await t.test(
      "bulk import stages only valid new requests and leaves imported phone unverified",
      async () => {
        const { organizationId: ignored, ...row } = input(2);
        const before = await dbCounts();
        const imported = await registration.import(actor, organizationId, [
          { ...row, collegeName: "  registration    college  " },
          row,
          { ...row, email: "invalid" },
          {
            ...row,
            studentId: "WRONG-COLLEGE",
            email: "wrongcollege@registration.example.test",
            collegeName: "Another College",
          },
          { ...row, role: "platform_admin" },
        ]);
        assert.equal(imported.created, 1);
        assert.deepEqual(
          imported.results.map((result) => result.status),
          ["pending", "duplicate", "invalid", "invalid", "invalid"],
        );
        assert.match(imported.results[3].message!, /College name must match/);
        assert.deepEqual(await dbCounts(), before);
        const id = imported.results[0].id!;
        assert.equal(
          (await registration.approve(actor, [id])).results[0].status,
          "approved",
        );
        const [request] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.id, id)),
        );
        const [member] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(s.members)
            .where(eq(s.members.id, request.memberId!)),
        );
        assert.equal(request.source, "import");
        assert.equal(member.phoneVerifiedAt, null);
        assert.equal(member.passwordSetupComplete, false);
      },
    );
    await t.test(
      "rejection creates no account; a corrected request can be submitted again",
      async () => {
        const receipt = await registration.submit(input(3), "reject-client");
        const before = await dbCounts();
        assert.equal(
          (
            await registration.reject(
              actor,
              receipt.id,
              "Please correct your student ID.",
            )
          ).status,
          "rejected",
        );
        assert.equal(
          (await registration.approve(actor, [receipt.id])).results[0].status,
          "rejected",
        );
        assert.deepEqual(await dbCounts(), before);
        assert.equal(
          (await registration.submit(input(3), "corrected-client")).status,
          "pending",
        );
      },
    );
    await t.test(
      "failure after identity creation rolls back account, member, email, audit and request; retry succeeds",
      async () => {
        const receipt = await registration.submit(input(4), "rollback-client");
        const before = await dbCounts();
        await connection.db.execute(
          sql.raw(
            "CREATE FUNCTION registration_test_mail_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='welcome_student' THEN RAISE EXCEPTION 'simulated outbox failure'; END IF; RETURN NEW; END $$;",
          ),
        );
        await connection.db.execute(
          sql.raw(
            "CREATE TRIGGER registration_test_mail_failure BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION registration_test_mail_failure();",
          ),
        );
        try {
          assert.equal(
            (await registration.approve(actor, [receipt.id])).results[0].status,
            "failed",
          );
          assert.deepEqual(await dbCounts(), before);
          const [request] = await service.scope(actor, (tx) =>
            tx
              .select()
              .from(registrationRequests)
              .where(eq(registrationRequests.id, receipt.id)),
          );
          assert.equal(request.status, "pending");
          assert.equal(request.memberId, null);
          assert.equal(request.welcomeOutboxId, null);
          const records = await service.scope(actor, (tx) =>
            tx.select().from(s.audit).where(eq(s.audit.resourceId, receipt.id)),
          );
          assert.equal(records.length, 0);
        } finally {
          await connection.db.execute(
            sql.raw("DROP TRIGGER registration_test_mail_failure ON outbox;"),
          );
          await connection.db.execute(
            sql.raw("DROP FUNCTION registration_test_mail_failure();"),
          );
        }
        assert.equal(
          (await registration.approve(actor, [receipt.id])).results[0].status,
          "approved",
        );
      },
    );
    await t.test(
      "retry email is explicit, scoped and cannot duplicate accepted or expired mail",
      async () => {
        const [request] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.id, firstId)),
        );
        await connection.db
          .update(s.outbox)
          .set({ status: "failed", attempts: 5 })
          .where(eq(s.outbox.id, request.welcomeOutboxId!));
        assert.equal(
          (await registration.retryEmail(actor, firstId)).emailStatus,
          "pending",
        );
        await assert.rejects(
          () => registration.retryEmail(actor, firstId),
          /Only failed/,
        );
        await connection.db
          .update(s.outbox)
          .set({ status: "accepted", encryptedPayload: "" })
          .where(eq(s.outbox.id, request.welcomeOutboxId!));
        await assert.rejects(
          () => registration.retryEmail(actor, firstId),
          /Only failed/,
        );
        await connection.db
          .update(s.outbox)
          .set({
            status: "failed",
            encryptedPayload: "expired-ciphertext",
            expiresAt: new Date(Date.now() - 1000),
          })
          .where(eq(s.outbox.id, request.welcomeOutboxId!));
        await assert.rejects(
          () => registration.retryEmail(actor, firstId),
          /Only failed/,
        );
      },
    );
    await t.test(
      "welcome login links are restricted to trusted student origins and invalid configuration rolls back",
      async () => {
        const receipt = await registration.submit(input(5), "portal-client");
        const before = await dbCounts();
        for (const invalid of [
          "https://untrusted.example.test",
          "http://username:password@localhost:5173",
          "javascript:alert(1)",
        ]) {
          process.env.STUDENT_PORTAL_URL = invalid;
          assert.equal(
            (await registration.approve(actor, [receipt.id])).results[0].status,
            "failed",
          );
          assert.deepEqual(await dbCounts(), before);
        }
        process.env.STUDENT_PORTAL_URL = "http://localhost:5173/ignored/path";
        assert.equal(
          (await registration.approve(actor, [receipt.id])).results[0].status,
          "approved",
        );
        const [request] = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.id, receipt.id)),
        );
        const [mail] = await connection.db
          .select()
          .from(s.outbox)
          .where(eq(s.outbox.id, request.welcomeOutboxId!));
        assert.equal(
          decryptPayload(
            config.secret,
            mail.encryptedPayload,
            "welcome_student",
          ).loginUrl,
          "http://localhost:5173/login",
        );
        process.env.STUDENT_PORTAL_URL = "http://localhost:5173";
      },
    );
    await t.test(
      "registration review rows remain invisible through organization tenant roles",
      async () => {
        for (const readonly of [true, false]) {
          if (readonly) {
            await assert.rejects(
              () =>
                scoped(connection.db, { organizationId, readonly }, (tx) =>
                  tx.select().from(registrationRequests),
                ),
              (error) =>
                (error as { cause?: { code?: string } }).cause?.code ===
                "42501",
            );
          } else {
            assert.deepEqual(
              await scoped(connection.db, { organizationId }, (tx) =>
                tx.select().from(registrationRequests),
              ),
              [],
            );
          }
        }
        await assert.rejects(
          () =>
            registration.list({
              ...actor,
              role: "organization_viewer",
              organizationId,
            }),
          /Only Platform Admin/,
        );
        await assert.rejects(
          () =>
            registration.retryEmail(
              { ...actor, role: "organization_viewer", organizationId },
              firstId,
            ),
          /Only Platform Admin/,
        );
      },
    );
    await t.test(
      "public rate limits are durable and duplicate attempts count",
      async () => {
        for (let n = 0; n < 5; n++)
          await assert.rejects(
            () => registration.submit(input(1), "limited-client"),
            /already exists/,
          );
        await assert.rejects(
          () => registration.submit(input(8), "limited-client"),
          (error) => (error as { getStatus(): number }).getStatus() === 429,
        );
        const records = await service.scope(actor, (tx) =>
          tx
            .select()
            .from(registrationRequests)
            .where(eq(registrationRequests.email, input(8).email)),
        );
        assert.equal(records.length, 0);
      },
    );
  } finally {
    await connection.close();
  }
});
