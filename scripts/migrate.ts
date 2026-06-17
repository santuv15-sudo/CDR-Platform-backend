/**
 * Apply SQL migrations from backend/migrations/.
 * Run: npm run db:migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { requireDatabaseUrl } from "./lib/load-env.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../migrations");

async function main() {
  const sql = postgres(requireDatabaseUrl(), { prepare: false, max: 1 });

  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set(
    (await sql`SELECT id FROM schema_migrations`).map((r) => r.id as string),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }
    const ddl = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
    console.log(`  apply ${file}`);
    await sql.unsafe(ddl);
    await sql`INSERT INTO schema_migrations (id) VALUES (${file})`;
  }

  console.log("Migrations complete.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
