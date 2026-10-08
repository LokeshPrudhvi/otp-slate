import { PGlite } from "@electric-sql/pglite";
import {
  drizzle as localDrizzle,
  type PgliteDatabase,
} from "drizzle-orm/pglite";
import { drizzle as postgresDrizzle } from "drizzle-orm/node-postgres";
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
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = postgresDrizzle(pool, { schema }) as unknown as Database;
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
    sql`select r.rolsuper, r.rolbypassrls, exists(select 1 from pg_tables where schemaname='public' and tablename like 'slate_%' and tableowner=current_user) as owns_domain from pg_roles r where r.rolname=current_user`,
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls || role.owns_domain)
    throw new Error(
      "The production runtime database role must not own domain tables, be superuser or bypass RLS.",
    );
}
export async function scoped<T>(
  db: Database,
  context: {
    authId?: string;
    organizationId?: string | null;
    platform?: boolean;
    readonly?: boolean;
    mailbox?: boolean;
  },
  work: (tx: Transaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        context.mailbox
          ? "SET LOCAL ROLE slate_mailbox"
          : context.readonly
            ? "SET LOCAL ROLE slate_reader"
            : "SET LOCAL ROLE slate_runtime",
      ),
    );
    await tx.execute(
      sql`select set_config('slate.auth_id', ${context.authId || ""}, true), set_config('slate.org_id', ${context.organizationId || ""}, true), set_config('slate.is_platform', ${context.platform ? "true" : "false"}, true)`,
    );
    return work(tx);
  });
}
