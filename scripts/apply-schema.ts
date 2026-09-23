// Applies db/schema.sql to the Neon database named by DATABASE_URL.
//
// Usage: npm run db:apply
//
// The file is idempotent (every statement is CREATE ... IF NOT EXISTS), so
// this is safe to re-run and is the only way the schema is ever changed --
// there is no migration tool and no ad-hoc DDL anywhere in the app.
//
// It runs over the pooled connection string via the serverless driver's
// HTTP transport. Nothing here needs a session-level feature, so the
// unpooled string is not required.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

/**
 * Splits the file into statements on semicolons that end a line.
 *
 * The driver's HTTP transport sends one statement per request, so the file
 * has to be split. Every statement in schema.sql is a single CREATE that
 * ends its own line, and there are no semicolons inside string literals or
 * dollar-quoted bodies, so this split is exact for this file. It would not
 * be for a file with a function body, which is why there isn't one.
 */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local (dev) or the Vercel project env.");
    process.exit(1);
  }

  const sql = neon(url);
  const file = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  const stmts = statements(file);
  console.log(`Applying db/schema.sql (${stmts.length} statements)…`);

  for (const stmt of stmts) {
    const label = stmt.replace(/\s+/g, " ").slice(0, 72);
    await sql.query(stmt);
    console.log(`  ok  ${label}…`);
  }

  const tables = (await sql`
    SELECT table_name, (SELECT count(*) FROM information_schema.columns c
                        WHERE c.table_name = t.table_name AND c.table_schema = 'public') AS columns
    FROM information_schema.tables t
    WHERE table_schema = 'public'
    ORDER BY table_name`) as { table_name: string; columns: number }[];

  console.log("\nTables in public schema:");
  for (const t of tables) console.log(`  ${t.table_name} (${t.columns} columns)`);
}

main().catch((err) => {
  // The driver's message names the host, never the password, but keep the
  // output to the message alone rather than the whole error object.
  console.error("Schema apply failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
