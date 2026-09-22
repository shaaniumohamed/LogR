import { readFileSync } from "node:fs";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

/**
 * drizzle/schema.sql is the same schema by hand, for pasting into a SQL console
 * when there is no terminal to run `npm run db:push` from. Two copies of one
 * truth drift: drizzle/0000_*.sql was once that second copy, and by the time
 * anyone looked it built 10 of the 16 tables — a database that looks fine until
 * the first screenshot upload fails.
 *
 * So the second copy is checked against the first. This reads the table
 * metadata drizzle itself builds, rather than parsing schema.ts, so renaming a
 * column in TypeScript is enough to fail it. It is a presence check, not a
 * parser: it cannot tell you the TYPE is right in the SQL. What it does catch
 * is the failure that actually happened — something new in schema.ts that the
 * pasteable file never heard of.
 */
const sql = readFileSync(new URL("../drizzle/schema.sql", import.meta.url), "utf8");

/** Everything `pgTable(...)` in the schema module, with its real SQL names. */
const exported: unknown[] = Object.values(schema);
const tables = exported
  .filter((v): v is PgTable => v instanceof PgTable)
  .map((t) => getTableConfig(t));

describe("drizzle/schema.sql matches lib/db/schema.ts", () => {
  it("finds every table", () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(sql, `CREATE TABLE for "${t.name}"`).toContain(
        `CREATE TABLE IF NOT EXISTS "${t.name}" (`
      );
    }
  });

  it("finds every column, inside its own table", () => {
    for (const t of tables) {
      // The block from this table's CREATE to the closing paren: a column named
      // in some OTHER table must not count as this one being present.
      const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS "${t.name}" (`);
      const block = sql.slice(start, sql.indexOf("\n);", start));
      for (const c of t.columns) {
        expect(block, `column "${c.name}" of "${t.name}"`).toContain(`"${c.name}"`);
      }
    }
  });

  it("finds every index", () => {
    for (const t of tables) {
      for (const i of t.indexes) {
        expect(sql, `index ${i.config.name}`).toContain(`"${i.config.name}"`);
      }
    }
  });

  it("only ever adds — no statement in it can destroy a trade", () => {
    const destructive = /^\s*(DROP|TRUNCATE|DELETE)\b/gim;
    expect(sql.match(destructive)).toBeNull();
  });
});
