import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { createAuth } from "./auth.js";
import { migration } from "./migration.js";
import * as schema from "./schema.js";

test("native auth joins use one fresh session read and preserve revocation and login bans", async () => {
  const client = new PGlite();
  await client.waitReady;
  await client.exec(migration);
  const statements: string[] = [];
  const db = drizzle(client, {
    schema,
    logger: {
      logQuery(query) {
        statements.push(query);
      },
    },
  });
  const auth = createAuth(
    db,
    {
      production: false,
      databaseUrl: "pglite://memory",
      migrationUrl: undefined,
      secret: "native-auth-joins-test-only-secret-at-least-32-characters",
      authUrl: "http://localhost:3000",
      origins: ["http://localhost:5173"],
      port: 3000,
    },
    true,
  );
  try {
    const credentials = {
      email: "native-joins@example.test",
      password: "Native-auth-joins-only!2026",
    };
    const identity = await auth.api.createUser({
      body: { ...credentials, name: "Native joins" },
    });
    statements.length = 0;
    const login = await auth.api.signInEmail({
      body: credentials,
      asResponse: true,
    });
    assert.equal(login.status, 200);
    assert.ok(
      statements.some(
        (query) =>
          query.includes('"auth_user"') && query.includes('"auth_account"'),
      ),
      "sign-in should fetch the user and password account together",
    );
    const headers = new Headers({
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    });
    const getSession = () =>
      auth.api.getSession({
        headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
    statements.length = 0;
    const current = await getSession();
    assert.equal(current?.user.id, identity.user.id);
    assert.equal(
      statements.length,
      1,
      "session validation must require only one SQL round trip",
    );
    assert.ok(
      statements[0].includes('"auth_session"') &&
        statements[0].includes('"auth_user"'),
    );
    const token = await auth.api.getToken({ headers });
    assert.equal(
      token.token.split(".").length,
      3,
      "explicit JWT issuance must remain available",
    );

    await db
      .update(schema.user)
      .set({ name: "Current database name" })
      .where(eq(schema.user.id, identity.user.id));
    assert.equal(
      (await getSession())?.user.name,
      "Current database name",
      "native joins must not reuse stale user data",
    );
    await db
      .delete(schema.session)
      .where(eq(schema.session.id, current!.session.id));
    assert.equal(
      await getSession(),
      null,
      "revoked sessions must stop working on the next request",
    );

    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.id, identity.user.id));
    const bannedLogin = await auth.api.signInEmail({
      body: credentials,
      asResponse: true,
    });
    assert.equal(bannedLogin.status, 403);
  } finally {
    await client.close();
  }
});
