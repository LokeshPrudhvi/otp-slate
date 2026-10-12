// Dry-run by default. This provisions only a login and grants, never schema or data.
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

const root = fileURLToPath(new URL("../", import.meta.url));
const role = "slate_api_render";
const scopedRoles = [
  "slate_runtime",
  "slate_reader",
  "slate_mailbox",
  "slate_registration",
];
const authTables = [
  "auth_user",
  "auth_session",
  "auth_account",
  "auth_verification",
  "auth_jwks",
  "auth_two_factor",
  "auth_rate_limit",
];
const domainTables = [
  "organizations",
  "members",
  "courses",
  "course_versions",
  "course_enrollments",
  "lesson_progress",
  "jobs",
  "resumes",
  "phone_challenges",
  "audit_logs",
  "messages",
  "message_deliveries",
  "registration_requests",
  "registration_rate_limits",
  "access_policies",
];
const output = resolve(root, ".local/render-runtime.env");
const args = process.argv.slice(2);
if (args.some((arg) => !["--apply", "--help"].includes(arg))) {
  console.error("Use node scripts/provision-runtime-role.mjs [--apply].");
  process.exit(1);
}
if (args.includes("--help")) {
  console.log(
    "Default: read-only preflight. --apply: create the restricted Render login and verify it. Credentials stay in ignored .local/render-runtime.env; never printed.",
  );
  process.exit(0);
}
const apply = args.includes("--apply");
const identifier = (value) => `"${value.replaceAll('"', '""')}"`;
const qualified = (table) => `public.${identifier(table)}`;
class ProvisioningError extends Error {}

function connectionUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProvisioningError(
      `${label} must be a PostgreSQL TLS connection URL.`,
    );
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.password ||
    !["require", "verify-ca", "verify-full"].includes(
      url.searchParams.get("sslmode"),
    )
  )
    throw new ProvisioningError(
      `${label} must be a PostgreSQL TLS connection URL.`,
    );
  return url;
}
function makeClient(url) {
  const client = new pg.Client({
    connectionString: url.toString(),
    connectionTimeoutMillis: 15_000,
    query_timeout: 15_000,
    application_name: "slate-runtime-provision",
  });
  // Never print query text, connection strings or provider notices.
  client.on("error", () => {});
  return client;
}
function assertRoleAttributes(row) {
  if (
    !row ||
    !row.rolcanlogin ||
    row.rolinherit ||
    row.rolsuper ||
    row.rolbypassrls ||
    row.rolcreatedb ||
    row.rolcreaterole ||
    row.rolreplication
  )
    throw new ProvisioningError(
      "Existing runtime login has unexpected privileges. Review it manually; no automatic resets are allowed.",
    );
}
async function inspectRole(client) {
  const { rows } = await client.query(
    "SELECT rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication FROM pg_roles WHERE rolname=$1",
    [role],
  );
  return rows[0];
}
async function verifyRuntime(url) {
  const { connectDatabase, checkProductionRole, scoped } =
    await import("../apps/api/dist/database.js");
  const { sql } = await import("drizzle-orm");
  const connection = await connectDatabase(url.toString());
  try {
    await checkProductionRole(connection.db);
    const unscoped = await connection.db.execute(
      sql`SELECT has_table_privilege(current_user,'public.members','SELECT,INSERT,UPDATE,DELETE') AS members, has_table_privilege(current_user,'public.courses','SELECT,INSERT,UPDATE,DELETE') AS courses`,
    );
    if (unscoped.rows[0].members || unscoped.rows[0].courses)
      throw new ProvisioningError(
        "Runtime verification found unexpected direct domain privileges.",
      );
    // Only existence/empty-result probes: no student identities or content are read.
    await scoped(connection.db, { platform: true }, (tx) =>
      tx.execute(sql`SELECT id FROM organizations WHERE false`),
    );
    const emptyScope = await scoped(connection.db, {}, (tx) =>
      tx.execute(sql`SELECT EXISTS(SELECT 1 FROM members) AS visible`),
    );
    if (emptyScope.rows[0].visible)
      throw new ProvisioningError(
        "Unscoped tenant rows are visible to the runtime role.",
      );
    await scoped(connection.db, { readonly: true }, (tx) =>
      tx.execute(sql`SELECT id FROM courses WHERE false`),
    );
    await scoped(connection.db, { mailbox: true }, (tx) =>
      tx.execute(sql`SELECT id FROM messages WHERE false`),
    );
    await connection.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE slate_registration`);
      await tx.execute(
        sql`SELECT id,name,status FROM organizations WHERE false`,
      );
    });
  } finally {
    await connection.close();
  }
}

async function main() {
  const env = dotenv.parse(readFileSync(resolve(root, ".env")));
  const pooled = connectionUrl(env.DATABASE_URL, "DATABASE_URL");
  const direct = connectionUrl(
    env.MIGRATION_DATABASE_URL,
    "MIGRATION_DATABASE_URL",
  );
  if (
    !pooled.hostname.includes("-pooler.") ||
    direct.hostname.includes("-pooler.") ||
    pooled.hostname.replace("-pooler.", ".") !== direct.hostname ||
    pooled.pathname !== direct.pathname ||
    pooled.port !== direct.port
  )
    throw new ProvisioningError(
      "Expected matching pooled runtime and direct migration URLs for the same existing database.",
    );
  if (
    spawnSync("git", ["check-ignore", "--quiet", ".local/render-runtime.env"], {
      cwd: root,
    }).status !== 0
  )
    throw new ProvisioningError(
      "The credential destination must be ignored by Git.",
    );
  if (
    existsSync(resolve(root, ".local")) &&
    !lstatSync(resolve(root, ".local")).isDirectory()
  )
    throw new ProvisioningError(
      "The credential directory must be a regular local directory.",
    );
  let saved;
  if (existsSync(output)) {
    const stat = lstatSync(output);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new ProvisioningError(
        "Saved runtime credentials must be a regular private file with mode 0600.",
      );
    saved = connectionUrl(
      dotenv.parse(readFileSync(output)).DATABASE_URL,
      "Saved runtime DATABASE_URL",
    );
    if (
      decodeURIComponent(saved.username) !== role ||
      saved.hostname !== pooled.hostname ||
      saved.pathname !== pooled.pathname ||
      saved.port !== pooled.port
    )
      throw new ProvisioningError(
        "Saved credentials do not match this runtime role and database. No reset was attempted.",
      );
  }
  if (!existsSync(resolve(root, "apps/api/dist/database.js")))
    throw new ProvisioningError(
      "Build contracts and the API before provisioning so runtime verification is available.",
    );

  const owner = makeClient(direct);
  await owner.connect();
  let transaction = false;
  try {
    const {
      rows: [server],
    } = await owner.query(
      "SELECT current_setting('server_version_num')::int AS version, current_database() AS database",
    );
    if (server.version < 160000)
      throw new ProvisioningError(
        "Explicit SET-only memberships require PostgreSQL 16 or later.",
      );
    const { rows: roles } = await owner.query(
      "SELECT rolname,rolcanlogin,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])",
      [scopedRoles],
    );
    if (
      roles.length !== scopedRoles.length ||
      roles.some((r) => r.rolcanlogin || r.rolsuper || r.rolbypassrls)
    )
      throw new ProvisioningError(
        "Expected restricted NOLOGIN application roles are missing or unsafe. Apply no schema changes automatically.",
      );
    const { rows: tables } = await owner.query(
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])",
      [[...authTables, "outbox", ...domainTables]],
    );
    if (tables.length !== authTables.length + domainTables.length + 1)
      throw new ProvisioningError(
        "The existing database is missing required application tables. Provisioning does not run migrations.",
      );
    const existing = await inspectRole(owner);
    if (existing && !saved)
      throw new ProvisioningError(
        "The runtime login already exists but no matching private credential file is available. Refusing to reset its password.",
      );
    if (existing) {
      assertRoleAttributes(existing);
      const runtime = makeClient(saved);
      try {
        await runtime.connect();
        await runtime.query("SELECT 1");
      } finally {
        await runtime.end();
      }
    }
    console.log(
      `Preflight passed: PostgreSQL ${Math.floor(server.version / 10000)}, four scoped roles and all application tables found. ${existing ? "Saved login authenticated." : "Runtime login is not yet created."}`,
    );
    if (!apply) {
      console.log(
        "Dry run only: no credentials generated or database changes made. Run with --apply to provision slate_api_render.",
      );
      return;
    }
    const runtimeUrl = saved || new URL(pooled);
    if (!saved) {
      runtimeUrl.username = role;
      runtimeUrl.password = randomBytes(48).toString("hex");
      runtimeUrl.searchParams.set("sslmode", "verify-full");
    }
    await owner.query("BEGIN");
    transaction = true;
    await owner.query("SET LOCAL lock_timeout='5s'");
    await owner.query("SET LOCAL statement_timeout='15s'");
    if (!existing) {
      // A randomly generated hex password is never included in logs or CLI arguments.
      const password = decodeURIComponent(runtimeUrl.password);
      if (!/^[a-f0-9]{96}$/.test(password))
        throw new ProvisioningError(
          "Uncommitted saved credentials have an unexpected format.",
        );
      await owner.query(
        `CREATE ROLE ${identifier(role)} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password}'`,
      );
    }
    for (const scopeRole of scopedRoles) {
      for (const option of ["INHERIT FALSE", "SET TRUE", "ADMIN FALSE"])
        await owner.query(
          `GRANT ${identifier(scopeRole)} TO ${identifier(role)} WITH ${option}`,
        );
    }
    await owner.query(
      `GRANT CONNECT ON DATABASE ${identifier(server.database)} TO ${identifier(role)}`,
    );
    await owner.query(`GRANT USAGE ON SCHEMA public TO ${identifier(role)}`);
    await owner.query(
      `GRANT SELECT,INSERT,UPDATE,DELETE ON ${authTables.map(qualified).join(",")} TO ${identifier(role)}`,
    );
    await owner.query(
      `GRANT SELECT,INSERT,UPDATE ON public.outbox TO ${identifier(role)}`,
    );
    const { rows: missingGrants } = await owner.query(
      "SELECT name FROM unnest($2::text[]) name WHERE NOT (has_table_privilege($1, 'public.' || quote_ident(name), 'SELECT') AND has_table_privilege($1, 'public.' || quote_ident(name), 'INSERT') AND has_table_privilege($1, 'public.' || quote_ident(name), 'UPDATE') AND (name='outbox' OR has_table_privilege($1, 'public.' || quote_ident(name), 'DELETE')))",
      [role, [...authTables, "outbox"]],
    );
    if (missingGrants.length)
      throw new ProvisioningError(
        "Required direct auth or outbox grants are missing. Transaction rolled back.",
      );
    const { rows: memberships } = await owner.query(
      "SELECT r.rolname,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE m.member=(SELECT oid FROM pg_roles WHERE rolname=$1)",
      [role],
    );
    if (
      memberships.length !== scopedRoles.length ||
      memberships.some(
        (m) =>
          !scopedRoles.includes(m.rolname) ||
          m.admin_option ||
          m.inherit_option ||
          !m.set_option,
      )
    )
      throw new ProvisioningError(
        "Runtime memberships differ from the expected SET-only role grants.",
      );
    const { rows: unauthorized } = await owner.query(
      "SELECT name FROM unnest($2::text[]) name WHERE has_table_privilege($1, 'public.' || quote_ident(name), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege($1, 'public.' || quote_ident(name), 'SELECT,INSERT,UPDATE,REFERENCES')",
      [role, domainTables],
    );
    if (unauthorized.length)
      throw new ProvisioningError(
        "Runtime login has unexpected direct or inherited domain privileges. Transaction rolled back.",
      );
    assertRoleAttributes(await inspectRole(owner));
    if (!saved) {
      mkdirSync(resolve(root, ".local"), { recursive: true, mode: 0o700 });
      writeFileSync(
        output,
        `# Private Render runtime login. Do not commit or print.\nDATABASE_URL=${JSON.stringify(runtimeUrl.toString())}\n`,
        { mode: 0o600, flag: "wx", flush: true },
      );
    }
    // Save before commit so a process/network failure cannot lose the new credential.
    // If commit outcome is uncertain, retain the file and rerun safely; never reset.
    await owner.query("COMMIT");
    transaction = false;
    await verifyRuntime(runtimeUrl);
    console.log(
      "Restricted runtime login provisioned and verified. Credentials are saved privately in .local/render-runtime.env (0600). Existing data and schema were not modified.",
    );
  } finally {
    if (transaction) await owner.query("ROLLBACK").catch(() => {});
    await owner.end();
  }
}

main().catch((error) => {
  // Known local validation errors contain no input values. Driver errors stay redacted.
  const message =
    error instanceof ProvisioningError
      ? error.message
      : "Database connection or grant verification failed; no provider details are printed.";
  console.error(message);
  if (error?.code && /^[A-Z0-9_]{2,40}$/.test(error.code))
    console.error(`Error code: ${error.code}`);
  process.exitCode = 1;
});
