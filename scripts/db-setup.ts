/**
 * Full database setup: migrations + gettao dimension seed + user seed.
 * Run once on a fresh Supabase project: npm run db:setup
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, "..");
const node = process.execPath;
const run = (script: string) => {
  const r = spawnSync(node, ["--experimental-strip-types", script], {
    cwd: backendRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

console.log("==> migrations");
run("scripts/migrate.ts");
console.log("==> dimension seed (gettao table.csv)");
run("scripts/seed-dimensions.ts");
console.log("==> auth seed (gettao users.json)");
run("scripts/seed-users.ts");
console.log("✅ db:setup complete");
