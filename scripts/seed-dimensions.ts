/**
 * Seed district_managers, branches, staff from gettao table.csv.
 * Run after: npm run db:migrate
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import postgres from "postgres";
import { requireDatabaseUrl } from "./lib/load-env.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = resolve(__dirname, "../seed-data/table.csv");

interface CsvRow {
  "Branch #": string;
  "Branch Name": string;
  Address?: string;
  Phone?: string;
  FAX?: string;
  Opened?: string;
  "District Manager": string;
  Staff: string;
  Extension: string;
}

function dmKey(name: string): string {
  return name.trim().split(/\s+/)[0].toLowerCase();
}

async function main() {
  const sql = postgres(requireDatabaseUrl(), { prepare: false });
  const csv = readFileSync(CSV_PATH, "utf8");
  const { data } = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });

  const dmNames = new Map<string, string>();
  const branches = new Map<number, { name: string; dmKey: string; address: string; phone: string; fax: string; opened: string }>();
  const staffRows: { name: string; extension: string; branchId: number; dmKey: string }[] = [];

  for (const row of data) {
    const branchId = parseInt(String(row["Branch #"] ?? "").trim(), 10);
    const branchName = String(row["Branch Name"] ?? "").trim();
    const dmRaw = String(row["District Manager"] ?? "").trim();
    const staffName = String(row.Staff ?? "").trim();
    const extension = String(row.Extension ?? "").trim();
    const address = String(row.Address ?? "").trim();
    const phone = String(row.Phone ?? "").trim();
    const fax = String(row.FAX ?? "").trim();
    const opened = String(row.Opened ?? "").trim();

    if (!branchId || !branchName || !dmRaw) continue;

    const key = dmKey(dmRaw);
    if (!dmNames.has(key)) dmNames.set(key, dmRaw);

    if (!branches.has(branchId)) {
      branches.set(branchId, { name: branchName, dmKey: key, address, phone, fax, opened });
    }

    if (staffName && extension) {
      staffRows.push({ name: staffName, extension, branchId, dmKey: key });
    }
  }

  console.log(`Seeding ${dmNames.size} DMs, ${branches.size} branches, ${staffRows.length} staff...`);

  for (const [key, name] of dmNames) {
    await sql`
      INSERT INTO district_managers (key, name) VALUES (${key}, ${name})
      ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
    `;
  }

  const dmRows = await sql`SELECT id, key FROM district_managers`;
  const dmByKey = new Map(dmRows.map((r) => [r.key as string, r.id as number]));

  for (const [id, b] of branches) {
    const dmId = dmByKey.get(b.dmKey) ?? null;
    await sql`
      INSERT INTO branches (id, name, dm_id, address, phone, fax, opened, active, updated_at)
      VALUES (${id}, ${b.name}, ${dmId}, ${b.address}, ${b.phone}, ${b.fax}, ${b.opened}, true, now())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        dm_id = EXCLUDED.dm_id,
        address = ${b.address},
        phone = ${b.phone},
        fax = ${b.fax},
        opened = ${b.opened},
        active = true,
        updated_at = now()
    `;
  }

  await sql`UPDATE staff SET active = false, updated_at = now()`;
  for (const s of staffRows) {
    const dmId = dmByKey.get(s.dmKey) ?? null;
    const username = s.name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
    const existing = await sql`
      SELECT id FROM staff
      WHERE branch_id = ${s.branchId}
        AND extension = ${s.extension}
      LIMIT 1
    `;
    if (existing.length) {
      await sql`
        UPDATE staff
        SET name = ${s.name},
            username = ${username || null},
            dm_id = ${dmId},
            active = true,
            updated_at = now()
        WHERE id = ${existing[0].id}
      `;
    } else {
      await sql`
        INSERT INTO staff (name, username, extension, branch_id, dm_id, active)
        VALUES (${s.name}, ${username || null}, ${s.extension}, ${s.branchId}, ${dmId}, true)
      `;
    }
  }

  console.log("Dimension seed complete.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
