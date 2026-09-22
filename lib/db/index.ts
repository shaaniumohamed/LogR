import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleHttp, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Constructed eagerly: the Auth.js Drizzle adapter inspects the client to work
 * out its dialect, so this must be a real database object, not a lazy proxy.
 *
 * `next build` imports these modules to collect routes without ever running a
 * query, so a placeholder URL keeps the build working on a machine with no
 * environment file. Any real query against the placeholder fails loudly.
 */
const PLACEHOLDER = "postgresql://placeholder:placeholder@localhost/placeholder";
const url = process.env.DATABASE_URL ?? PLACEHOLDER;

if (url === PLACEHOLDER && process.env.NEXT_PHASE !== "phase-production-build") {
  console.warn("[logr] DATABASE_URL is not set — copy .env.example to .env.local. Queries will fail.");
}

/**
 * Two drivers, chosen by the shape of the connection string.
 *
 * In production this talks to Neon over HTTP, which is the only thing that
 * works from a serverless function: there is no connection pool to keep warm
 * and no socket that survives between invocations.
 *
 * That driver cannot talk to an ordinary Postgres, which makes running the app
 * against a local database impossible — and running it locally is exactly what
 * anyone wants to do before pushing a change to a journal holding a year of
 * somebody's trading. So a plain postgres:// host that is not Neon gets the
 * normal TCP driver instead.
 *
 * Detected from the URL rather than from a separate switch, because a switch is
 * a thing that ends up set wrongly in production, and the host name cannot be.
 */
const isNeon = /\.neon\.tech|neon\.build/.test(url) || url === PLACEHOLDER;

/*
 * Typed as the production driver, with the local one cast to it.
 *
 * A union of the two would be technically truer and practically useless: every
 * call site would have to satisfy both overload sets at once, and TypeScript
 * resolves `.returning()` against the intersection by dropping its argument.
 * The app only uses the query surface the two share — it never opens a
 * transaction, which is the one place they genuinely differ — so naming the
 * production shape keeps the checking sharp where it matters.
 */
export const db: NeonHttpDatabase<typeof schema> = isNeon
  ? drizzleHttp(neon(url), { schema })
  : (drizzleNode(url, { schema }) as unknown as NeonHttpDatabase<typeof schema>);

export { schema };
