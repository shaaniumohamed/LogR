import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
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

export const db = drizzle(neon(url), { schema });
export { schema };
