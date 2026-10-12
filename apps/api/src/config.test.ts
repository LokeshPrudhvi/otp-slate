import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const development = {
  NODE_ENV: "development",
  BETTER_AUTH_SECRET: "config-test-secret-at-least-32-characters",
};
const production = {
  ...development,
  NODE_ENV: "production",
  DATABASE_URL:
    "postgresql://slate_api:unused@db.example.test/slate?sslmode=require",
  BETTER_AUTH_URL: "https://api.example.test",
  TRUSTED_ORIGINS:
    "https://student.example.test,https://admin.example.test,https://organization.example.test",
};

test("hosted API uses Render PORT; local API_PORT remains the development override", () => {
  assert.equal(
    loadConfig({ ...production, PORT: "10000", API_PORT: "3000" }).port,
    10000,
  );
  assert.equal(loadConfig({ ...production, API_PORT: "3001" }).port, 3001);
  assert.equal(
    loadConfig({ ...development, PORT: "10000", API_PORT: "3001" }).port,
    3001,
  );
  assert.equal(loadConfig({ ...development, PORT: "10000" }).port, 10000);
  assert.equal(loadConfig(development).port, 3000);
});

test("an invalid selected port fails before listening", () => {
  for (const PORT of ["0", "-1", "65536", "3000.5", "invalid"])
    assert.throws(() => loadConfig({ ...production, PORT }), /PORT\/API_PORT/);
  assert.throws(
    () => loadConfig({ ...development, API_PORT: "bad", PORT: "10000" }),
    /PORT\/API_PORT/,
  );
});

test("production requires configured secrets and PostgreSQL without local fallbacks", () => {
  for (const BETTER_AUTH_SECRET of [undefined, "", "too-short"])
    assert.throws(
      () => loadConfig({ ...production, BETTER_AUTH_SECRET }),
      /BETTER_AUTH_SECRET/,
    );
  for (const DATABASE_URL of [
    undefined,
    "",
    "pglite://.local/slate",
    "postgres-not-a-url",
  ])
    assert.throws(
      () => loadConfig({ ...production, DATABASE_URL }),
      /PostgreSQL/,
    );
  assert.equal(loadConfig(production).databaseUrl, production.DATABASE_URL);
  assert.equal(loadConfig(production).secret, production.BETTER_AUTH_SECRET);
});

test("production trusted origins are explicit exact HTTPS origins", () => {
  for (const TRUSTED_ORIGINS of [
    undefined,
    "",
    "http://localhost:5173",
    "https://student.example.test/path",
    "https://*.example.test",
    "https://student.example.test,",
    "not-a-url",
    "https://user:password@student.example.test",
    "https://student.example.test?x=1",
  ])
    assert.throws(
      () => loadConfig({ ...production, TRUSTED_ORIGINS }),
      /TRUSTED_ORIGINS|Production portal origins/,
    );
  assert.deepEqual(
    loadConfig(production).origins,
    production.TRUSTED_ORIGINS.split(","),
  );
});

test("production authentication URL fails closed on missing or unsafe values", () => {
  for (const BETTER_AUTH_URL of [
    undefined,
    "",
    "http://localhost:3000",
    "not-a-url",
    "https://user:password@api.example.test",
    "https://api.example.test#fragment",
  ])
    assert.throws(
      () => loadConfig({ ...production, BETTER_AUTH_URL }),
      /authentication URL/,
    );
  assert.equal(
    loadConfig({
      ...production,
      BETTER_AUTH_URL: "https://api.example.test/api/auth",
    }).authUrl,
    "https://api.example.test/api/auth",
  );
});

test("the optional portal proxy secret must be strong when configured", () => {
  for (const base of [development, production]) {
    for (const PORTAL_PROXY_SECRET of [undefined, "", "  "])
      assert.equal(
        loadConfig({ ...base, PORTAL_PROXY_SECRET }).portalProxySecret,
        undefined,
      );
    assert.throws(
      () => loadConfig({ ...base, PORTAL_PROXY_SECRET: "too-short" }),
      /PORTAL_PROXY_SECRET/,
    );
    const key = "test-only-proxy-key-at-least-32-characters";
    assert.equal(
      loadConfig({ ...base, PORTAL_PROXY_SECRET: ` ${key} ` })
        .portalProxySecret,
      key,
    );
  }
});
