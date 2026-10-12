import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const workspaceRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
dotenv.config({ path: resolve(workspaceRoot, ".env"), quiet: true });

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  let secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret && !production) {
    const path = resolve(workspaceRoot, ".local/auth-secret");
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path))
      writeFileSync(path, randomBytes(48).toString("hex"), {
        mode: 0o600,
        flag: "wx",
      });
    secret = readFileSync(path, "utf8").trim();
  }
  if (!secret || secret.length < 32)
    throw new Error(
      "Set a random BETTER_AUTH_SECRET of at least 32 characters.",
    );
  const portalProxySecret = env.PORTAL_PROXY_SECRET?.trim();
  if (portalProxySecret && portalProxySecret.length < 32)
    throw new Error(
      "PORTAL_PROXY_SECRET must contain at least 32 characters when configured.",
    );
  const databaseUrl = env.DATABASE_URL?.trim() || "pglite://.local/slate";
  if (production) {
    let database: URL;
    try {
      database = new URL(databaseUrl);
    } catch {
      throw new Error(
        "Production requires a restricted PostgreSQL/Neon connection.",
      );
    }
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) ||
      !database.hostname
    )
      throw new Error(
        "Production requires a restricted PostgreSQL/Neon connection.",
      );
  }
  const trustedOrigins = env.TRUSTED_ORIGINS?.trim();
  if (production && !trustedOrigins)
    throw new Error("Set explicit HTTPS TRUSTED_ORIGINS for production.");
  const origins = (
    trustedOrigins ||
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://student.localhost:5173,http://admin.localhost:5174,http://organization.localhost:5175"
  )
    .split(",")
    .map((s) => s.trim());
  if (production) {
    for (const origin of origins) {
      const parsed = httpsUrl(origin, "Production portal origins");
      if (parsed.origin !== origin || parsed.hostname.includes("*"))
        throw new Error(
          "Production portal origins must be exact HTTPS origins without paths or wildcards.",
        );
    }
  }
  const authUrl = env.BETTER_AUTH_URL?.trim() || "http://localhost:3000";
  if (production) httpsUrl(authUrl, "The production authentication URL");
  // Render supplies PORT. Keep the explicit local API_PORT convention for dev.
  const apiPort = env.API_PORT?.trim();
  const platformPort = env.PORT?.trim();
  const port = Number(
    (production ? platformPort || apiPort : apiPort || platformPort) || 3000,
  );
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT/API_PORT must be between 1 and 65535.");
  return {
    production,
    secret,
    databaseUrl,
    migrationUrl: env.MIGRATION_DATABASE_URL?.trim(),
    origins,
    authUrl,
    port,
    ...(portalProxySecret ? { portalProxySecret } : {}),
  };
}

function httpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must use a valid HTTPS URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      `${label} must use HTTPS without credentials, query parameters or fragments.`,
    );
  return parsed;
}
export type Config = ReturnType<typeof loadConfig>;
