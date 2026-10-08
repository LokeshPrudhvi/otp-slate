import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const workspaceRoot = fileURLToPath(
  new URL("../../../", import.meta.url),
);
dotenv.config({ path: resolve(workspaceRoot, ".env"), quiet: true });

export function loadConfig() {
  const production = process.env.NODE_ENV === "production";
  let secret = process.env.BETTER_AUTH_SECRET?.trim();
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
  const databaseUrl =
    process.env.DATABASE_URL?.trim() || "pglite://.local/slate";
  if (production && !databaseUrl.startsWith("postgres"))
    throw new Error(
      "Production requires a restricted PostgreSQL/Neon connection.",
    );
  const origins = (
    process.env.TRUSTED_ORIGINS ||
    "http://localhost:5173,http://localhost:5174,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://student.localhost:5173,http://admin.localhost:5174,http://organization.localhost:5175"
  )
    .split(",")
    .map((s) => s.trim());
  if (
    production &&
    origins.some((origin) => new URL(origin).protocol !== "https:")
  )
    throw new Error("Production portal origins must use HTTPS.");
  const authUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  if (production && new URL(authUrl).protocol !== "https:")
    throw new Error("The production authentication URL must use HTTPS.");
  const port = Number(process.env.API_PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("API_PORT must be between 1 and 65535.");
  return {
    production,
    secret,
    databaseUrl,
    migrationUrl: process.env.MIGRATION_DATABASE_URL?.trim(),
    origins,
    authUrl,
    port,
  };
}
export type Config = ReturnType<typeof loadConfig>;
