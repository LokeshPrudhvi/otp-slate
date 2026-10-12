import { sql, type GetColumnData, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

type Columns = Record<string, AnyPgColumn>;
type Row<T extends Columns> = {
  [K in keyof T]: GetColumnData<T[K], "query">;
};

// JSON subqueries let independent read models share one network round trip.
// Keep Drizzle's column decoders: timestamps inside JSON arrive as strings,
// whereas application policy checks expect Date values (including expiration).
export function jsonObject<T extends Columns>(columns: T) {
  const entries = Object.entries(columns);
  const expression = sql<Row<T>>`jsonb_build_object(${sql.join(
    entries.flatMap(([key, column]) => [sql`${key}::text`, sql`${column}`]),
    sql`, `,
  )})`;
  const decode = (raw: unknown): Row<T> => {
    const value = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      entries.map(([key, column]) => [
        key,
        value[key] === null ? null : column.mapFromDriverValue(value[key]),
      ]),
    ) as Row<T>;
  };
  return { expression, decode };
}

export function jsonRows<T extends Columns>(
  columns: T,
  fromAndWhere: SQL,
): SQL<Row<T>[]> {
  const record = jsonObject(columns);
  return sql<
    Row<T>[]
  >`(select coalesce(jsonb_agg(${record.expression}), '[]'::jsonb) ${fromAndWhere})`.mapWith(
    (raw: unknown) => {
      const values = (
        typeof raw === "string" ? JSON.parse(raw) : raw
      ) as unknown[];
      return values.map(record.decode);
    },
  );
}
