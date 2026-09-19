import type { Config } from "drizzle-kit";

/**
 * drizzle-kit runs as a standalone CLI, so it does NOT get Next.js's automatic
 * .env.local loading — it sees only the ambient environment. Load the files
 * ourselves, in the same precedence Next.js uses (.env.local wins over .env).
 *
 * process.loadEnvFile is built into Node 20.12+, so this needs no dependency.
 * It throws when the file is absent, which is fine — CI and Vercel supply
 * DATABASE_URL through the real environment instead.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // no such file, or an older Node without loadEnvFile — fall through
  }
}

/**
 * `generate` only diffs the schema file against the migration journal, so it has
 * to work with no database in reach — on a fresh clone, in CI, and anywhere the
 * connection string is deliberately absent. Only the commands that actually
 * connect are worth failing early for.
 */
const NEEDS_DB = !process.argv.includes("generate");

if (NEEDS_DB && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set.\n" +
      "Create .env.local in the project root with your Neon pooled connection string:\n" +
      '  DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"'
  );
}

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
} satisfies Config;
