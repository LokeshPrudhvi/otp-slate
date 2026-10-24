import { placementLogoMigration } from "../apps/api/dist/placement-logo-migration.js";
import { jobLogoMigration } from "../apps/api/dist/job-logo-migration.js";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { loadConfig } from "../apps/api/dist/config.js";
import { placementMigration } from "../apps/api/dist/placement-migration.js";
const args = process.argv.slice(2);
const check = args.includes("--check");
const jobLogos = args.includes("--job-logos");
const placementLogos = args.includes("--placement-logos");
if (!check && !args.includes("--apply")) {
  console.log(
    "Usage: node scripts/apply-placement-migration.mjs --check --branch TEST_BRANCH, or --apply for configured MIGRATION_DATABASE_URL.",
  );
  process.exit(0);
}
const branch = args.includes("--branch")
  ? args[args.indexOf("--branch") + 1]
  : "codex-placement-resources";
const config = loadConfig();
let pool;
try {
  const testUrl = check
    ? execFileSync(
        "neon",
        [
          "connection-string",
          branch,
          "--project-id",
          "small-shape-18661054",
          "--database-name",
          "neondb",
          "--role-name",
          "neondb_owner",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim()
    : null;
  const url = testUrl || config.migrationUrl;
  if (!url || new URL(url).hostname.includes("-pooler"))
    throw new Error("DIRECT_CONNECTION_REQUIRED");
  pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 15000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      placementLogos
        ? placementLogoMigration
        : jobLogos
          ? jobLogoMigration
          : placementMigration,
    );
    if (check) {
      await client.query(
        "select set_config('role','slate_runtime',true),set_config('slate.is_platform','true',true),set_config('slate.auth_id','migration-check',true)",
      );
      const inserted = await client.query(
        jobLogos
          ? "insert into company_logos(company_name,company_key,sha256,object_key,file_name,content_type,size) values ('Migration check','migration check',repeat('0',64),'migration-check/logo.png','logo.png','image/png',64) returning id"
          : "insert into placement_resources(kind,title,provider,url,status) values ('certification','Migration check','Test provider','https://example.com','published') returning id",
      );
      await client.query("select set_config('slate.is_platform','false',true)");
      const visible = await client.query(
        `select id from ${jobLogos ? "company_logos" : "placement_resources"} where id=$1`,
        [inserted.rows[0].id],
      );
      if (visible.rowCount !== 1) throw new Error("VISIBILITY_CHECK_FAILED");
      await client.query("ROLLBACK");
      console.log(
        `${jobLogos ? "Company logo" : "Placement"} migration verified on isolated Neon branch; test changes rolled back.`,
      );
    } else {
      await client.query("COMMIT");
      console.log(
        `${jobLogos ? "Company logo" : "Placement resources"} migration applied to configured database.`,
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error(
    "Placement migration failed:",
    error.code ||
      (error.message?.startsWith("DIRECT_")
        ? error.message
        : "CONNECTION_OR_MIGRATION_ERROR"),
  );
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
