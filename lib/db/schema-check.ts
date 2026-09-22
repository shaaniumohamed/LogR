import { cache } from "react";
import { sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { db } from "./index";
import * as schema from "./schema";

/**
 * Is this failure the database being older than the code?
 *
 * Postgres answers a missing table with SQLSTATE 42P01 and a missing column
 * with 42703. Both mean the same thing here: someone deployed new code without
 * running the migration. The message is matched as well as the code, because
 * the serverless driver does not promise to carry SQLSTATE through on every
 * path and being wrong in that direction would swallow a real error.
 */
export function isSchemaBehind(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: unknown } | null;
  if (err?.code === "42P01" || err?.code === "42703") return true;
  if (/relation .+ does not exist|column .+ does not exist/i.test(err?.message ?? "")) return true;
  // A React Server Component wraps the original in `cause` on its way up, and
  // by the time a layout catches it the code and message live one level down.
  return err?.cause ? isSchemaBehind(err.cause) : false;
}

/**
 * Run a read that might outrun the database, and degrade instead of failing.
 *
 * A journal whose Patterns page returns a 500 with an opaque digest — because
 * one column it does not even need yet is absent — is worse than one that shows
 * the trades and says what to run. Only READS use this. A write that silently
 * did nothing would be far worse than a write that errors.
 */
export async function readOrDegrade<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (isSchemaBehind(e)) return fallback;
    throw e;
  }
}

/** Every table and column the code expects, read out of the schema module itself. */
export function expectedObjects(): { table: string; columns: string[] }[] {
  const exported: unknown[] = Object.values(schema);
  return exported
    .filter((v): v is PgTable => v instanceof PgTable)
    .map((t) => getTableConfig(t))
    .map((t) => ({ table: t.name, columns: t.columns.map((c) => c.name) }));
}

/**
 * What the code expects, minus what the database actually has.
 *
 * Pure, so it can be tested without a database. A table with nothing present is
 * named on its own rather than once per column: "invite" is the useful sentence,
 * "invite.email, invite.note, invite.created_at…" is noise around the same fact.
 */
export function missingFrom(
  expected: { table: string; columns: string[] }[],
  present: { table: string; column: string }[]
): string[] {
  const have = new Map<string, Set<string>>();
  for (const p of present) {
    if (!have.has(p.table)) have.set(p.table, new Set());
    have.get(p.table)!.add(p.column);
  }

  const missing: string[] = [];
  for (const e of expected) {
    const cols = have.get(e.table);
    if (!cols) { missing.push(e.table); continue; }
    for (const c of e.columns) if (!cols.has(c)) missing.push(`${e.table}.${c}`);
  }
  return missing;
}

/**
 * Cached on the way up only.
 *
 * Once the migration has run the answer cannot go back to complete, so an empty
 * result is worth keeping for the life of the instance. Anything else is
 * re-checked, so the warning disappears on the next request after the fix
 * rather than waiting for a cold start.
 */
let known: string[] | null = null;

/**
 * Which tables and columns the database is missing, or null if it could not be
 * asked at all — a connection failure is a different problem with a different
 * answer, and reporting it as "nothing is missing" would send someone looking
 * in the wrong place.
 *
 * One statement against the catalogue, rather than one probe per table. It runs
 * at most once per instance on a healthy deployment, and the whole answer is a
 * couple of hundred short rows.
 */
export const schemaGaps = cache(async (): Promise<string[] | null> => {
  if (known?.length === 0) return known;
  try {
    const rows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`
    );
    // The two drivers disagree about the shape of a raw result: node-postgres
    // returns { rows }, the Neon HTTP driver returns the array itself.
    const list = (Array.isArray(rows) ? rows : rows.rows) as { table_name: string; column_name: string }[];
    known = missingFrom(
      expectedObjects(),
      list.map((r) => ({ table: r.table_name, column: r.column_name }))
    );
    return known;
  } catch {
    return null;
  }
});
