/**
 * Seed app_users from gettao users.json.
 * Run after: npm run db:migrate && npm run db:seed:dimensions
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { requireDatabaseUrl } from "./lib/load-env.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_PATH = resolve(__dirname, "../seed-data/users.json");
const EMAIL_DOMAIN = process.env.AUTH_EMAIL_DOMAIN ?? "owngcc.com";

interface SeedUser {
  name: string;
  username: string;
  password: string;
  role: string;
  branches_managed?: number[];
  active?: boolean;
}

function emailFor(username: string): string {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

async function upsertAuthUser(
  sql: ReturnType<typeof postgres>,
  userId: string,
  email: string,
  password: string,
  name: string,
  role: string,
  staffId: number | null,
  branchesManaged: number[],
) {
  const hash = await bcrypt.hash(password, 10);
  const existing = await sql`SELECT id FROM app_users WHERE email = ${email} LIMIT 1`;

  if (existing.length) {
    await sql`
      UPDATE app_users
      SET password_hash = ${hash},
          name = ${name},
          role = ${role}::user_role,
          staff_id = ${staffId},
          branches_managed = ${branchesManaged},
          active = true,
          updated_at = now()
      WHERE email = ${email}
    `;
    return existing[0].id as string;
  }

  await sql`
    INSERT INTO app_users (id, email, password_hash, name, role, staff_id, branches_managed, active)
    VALUES (
      ${userId}::uuid, ${email}, ${hash}, ${name}, ${role}::user_role,
      ${staffId}, ${branchesManaged}, true
    )
  `;
  return userId;
}

async function main() {
  const sql = postgres(requireDatabaseUrl(), { prepare: false });
  const users: SeedUser[] = JSON.parse(readFileSync(USERS_PATH, "utf8"));

  const staffRows = await sql`SELECT id, username FROM staff WHERE username IS NOT NULL`;
  const staffByUsername = new Map(staffRows.map((s) => [s.username as string, s.id as number]));

  let created = 0;
  let updated = 0;

  for (const u of users) {
    if (u.active === false) continue;
    const email = emailFor(u.username);
    const existing = await sql`SELECT id FROM app_users WHERE email = ${email} LIMIT 1`;
    const userId = (existing[0]?.id as string | undefined) ?? randomUUID();
    const staffId = staffByUsername.get(u.username) ?? null;

    await upsertAuthUser(
      sql,
      userId,
      email,
      u.password,
      u.name,
      u.role,
      staffId,
      u.branches_managed ?? [],
    );
    if (existing.length) updated++;
    else created++;
  }

  console.log(`Auth seed complete. created=${created} updated=${updated}`);
  console.log(`Default login: superadmin@${EMAIL_DOMAIN} / Admin@2026`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
