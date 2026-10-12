import { PGlite } from "@electric-sql/pglite";
import {
  drizzle as localDrizzle,
  type PgliteDatabase,
} from "drizzle-orm/pglite";
import {
  drizzle as postgresDrizzle,
  NodePgTransaction,
} from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { resolve } from "node:path";
import { workspaceRoot } from "./config.js";
import * as schema from "./schema.js";
import { migration } from "./migration.js";

// Both drivers implement the same PostgreSQL query/transaction interface used here.
export type Database = PgliteDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const migrations = new WeakMap<Database, () => Promise<void>>();
const postgresPools = new WeakMap<Database, Pool>();
const minimumPostgresConnections = 2;

export async function prepareDatabasePool(pool: {
  connect(): Promise<{
    query(config: { text: string; query_timeout: number }): Promise<unknown>;
    release(discard?: boolean): void;
  }>;
  end(): Promise<void>;
}) {
  // Complete the connection handshake before API readiness, with one connection
  // available for requests while the mail worker uses the other. A single probe
  // also verifies the database behind the pooler. No periodic keepalive is used.
  const clients: {
    client: Awaited<ReturnType<typeof pool.connect>>;
    healthy: boolean;
  }[] = [];
  const initialized = await Promise.allSettled(
    Array.from({ length: minimumPostgresConnections }, async () => {
      const client = await pool.connect();
      const item = { client, healthy: false };
      clients.push(item);
      await client.query({ text: "select 1", query_timeout: 10_000 });
      item.healthy = true;
    }),
  );
  for (const item of clients) item.client.release(!item.healthy);
  const failed = initialized.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") {
    // Drain every acquisition and close successes before reporting startup
    // failure. An error closing the pool must not replace the connection error.
    await pool.end().catch(() => undefined);
    throw failed.reason;
  }
}

export async function connectDatabase(url: string) {
  if (url.startsWith("pglite://")) {
    const path = url.slice("pglite://".length);
    const client = new PGlite(
      path === "memory" ? undefined : resolve(workspaceRoot, path),
    );
    await client.waitReady;
    const db = localDrizzle(client, { schema });
    migrations.set(db, async () => {
      await client.transaction(async (tx) => {
        await tx.exec(migration);
      });
    });
    return { db, close: () => client.close(), local: true };
  }
  const pool = new Pool({
    connectionString: url,
    min: minimumPostgresConnections,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    pipeline: true,
  });
  // pg removes failed idle clients. Handle its error event so a network reset
  // cannot terminate the API; subsequent requests acquire a fresh connection.
  pool.on("error", (error: Error & { code?: string }) => {
    console.warn(
      "PostgreSQL idle connection closed; the pool will replace it.",
      {
        code: error.code || "CONNECTION_ERROR",
      },
    );
  });
  await prepareDatabasePool(pool);
  const db = postgresDrizzle(pool, { schema }) as unknown as Database;
  postgresPools.set(db, pool);
  migrations.set(db, async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
  return { db, close: () => pool.end(), local: false };
}
export async function migrateDatabase(db: Database) {
  const run = migrations.get(db);
  if (!run)
    throw new Error("No migration driver is registered for this connection.");
  await run();
}
export async function checkProductionRole(db: Database) {
  const result = await db.execute(
    sql`select r.rolsuper, r.rolbypassrls, exists(select 1 from pg_tables where schemaname='public' and tablename IN ('organizations','members','courses','course_versions','course_enrollments','lesson_progress','jobs','resumes','phone_challenges','outbox','audit_logs','messages','message_deliveries','registration_requests','registration_rate_limits','access_policies','lesson_uploads','lesson_submissions','announcements') and tableowner=current_user) as owns_domain from pg_roles r where r.rolname=current_user`,
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.owns_domain)
    throw new Error(
      "The production runtime database role must not own domain tables, be superuser or bypass RLS.",
    );
}
export type ScopeContext = {
  authId?: string;
  organizationId?: string | null;
  platform?: boolean;
  readonly?: boolean;
  mailbox?: boolean;
};

function scopeSettings(context: ScopeContext) {
  const role = context.mailbox
    ? "slate_mailbox"
    : context.readonly
      ? "slate_reader"
      : "slate_runtime";
  return sql`select set_config('role', ${role}, true), set_config('slate.auth_id', ${context.authId || ""}, true), set_config('slate.org_id', ${context.organizationId || ""}, true), set_config('slate.is_platform', ${context.platform ? "true" : "false"}, true)`;
}

export async function scoped<T>(
  db: Database,
  context: ScopeContext,
  work: (tx: Transaction) => Promise<T>,
) {
  const pool = postgresPools.get(db);
  if (pool) {
    const client = await pool.connect();
    const connection = postgresDrizzle(client, { schema });
    const dialect = new PgDialect();
    const tx = new NodePgTransaction(dialect, connection._.session, {
      fullSchema: connection._.fullSchema,
      schema: connection._.schema!,
      tableNamesMap: connection._.tableNamesMap,
    }) as unknown as Transaction;
    let discard = false;
    try {
      // Send setup without waiting between commands. PostgreSQL executes this
      // connection's statements in order, so role/RLS context precedes work.
      // Each promise is drained before commit/rollback or releasing the client.
      const begin = client.query("BEGIN");
      const settings = dialect.sqlToQuery(scopeSettings(context));
      const setup = client.query(settings.sql, settings.params);
      const results = await Promise.allSettled([
        begin,
        setup,
        Promise.resolve().then(() => work(tx)),
      ]);
      for (const result of results)
        if (result.status === "rejected") throw result.reason;
      const result = results[2] as PromiseFulfilledResult<T>;
      const committed = await client.query("COMMIT");
      if (committed.command !== "COMMIT")
        throw new Error("The database transaction could not be committed.");
      return result.value;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  }
  return db.transaction(async (tx) => {
    await tx.execute(scopeSettings(context));
    return work(tx);
  });
}
