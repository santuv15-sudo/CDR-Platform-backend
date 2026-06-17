/**
 * Seed the default superadmin login into app_users.
 * Prefer `npm run db:setup` for a full gettao-aligned database.
 * Run: npm run db:seed:user
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import postgres from "postgres";
import { requireDatabaseUrl } from "./lib/load-env.ts";

const DEFAULT_USER = {
  email: "superadmin@owngcc.com",
  password: "Admin@2026",
  name: "Super Admin",
  role: "superadmin",
};

async function main() {
  const sql = postgres(requireDatabaseUrl(), { prepare: false });
  const { email, password, name, role } = DEFAULT_USER;

  const existing = await sql`
    SELECT id FROM app_users WHERE email = ${email} LIMIT 1
  `;

  const userId = (existing[0]?.id as string | undefined) ?? randomUUID();
  const hash = await bcrypt.hash(password, 10);

  if (existing.length) {
    await sql`
      UPDATE app_users
      SET password_hash = ${hash},
          name = ${name},
          role = ${role}::user_role,
          active = true,
          updated_at = now()
      WHERE id = ${userId}::uuid
    `;
    console.log(`Updated password for existing user ${email}`);
  } else {
    await sql`
      INSERT INTO app_users (id, email, password_hash, name, role, active)
      VALUES (${userId}::uuid, ${email}, ${hash}, ${name}, ${role}::user_role, true)
    `;
    console.log(`Created auth user ${email}`);
  }

  console.log(`App user upserted (${role})`);
  console.log(`\nLogin: ${email} / ${password}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
