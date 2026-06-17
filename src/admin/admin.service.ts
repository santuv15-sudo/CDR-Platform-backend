import { BadRequestException, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { db } from "../lib/db";

type UserBody = {
  id?: string;
  email?: string;
  password?: string;
  name?: string;
  role?: string;
  staff_id?: number | null;
  branches_managed?: number[];
  active?: boolean;
};

type MappingBody = {
  branch_id?: number;
  branch_name?: string;
  dm_name?: string;
  address?: string;
  phone?: string;
  fax?: string;
  opened?: string;
  staff_name?: string;
  extension?: string;
  cdr_aliases?: string[];
};

@Injectable()
export class AdminService {
  async listUsers() {
    return db()`
      SELECT u.id, u.email, u.name, u.role, u.staff_id, u.branches_managed, u.active,
        u.last_login_at, u.created_at, s.name AS staff_name
      FROM app_users u
      LEFT JOIN staff s ON s.id = u.staff_id
      ORDER BY u.role, u.name
    `;
  }

  async createUser(body: UserBody) {
    if (!body.email || !body.password || !body.name || !body.role) {
      throw new BadRequestException("email, password, name and role are required");
    }
    const hash = await bcrypt.hash(body.password, 10);
    const rows = await db()`
      INSERT INTO app_users (email, password_hash, name, role, staff_id, branches_managed, active)
      VALUES (
        ${body.email.trim().toLowerCase()}, ${hash}, ${body.name}, ${body.role}::user_role,
        ${body.staff_id ?? null}, ${body.branches_managed ?? []}, ${body.active ?? true}
      )
      RETURNING id
    `;
    return { id: rows[0].id };
  }

  async updateUser(body: UserBody) {
    if (!body.id) throw new BadRequestException("id is required");
    const hash = body.password ? await bcrypt.hash(body.password, 10) : null;
    await db()`
      UPDATE app_users
      SET email = COALESCE(${body.email ?? null}, email),
          password_hash = COALESCE(${hash}, password_hash),
          name = COALESCE(${body.name ?? null}, name),
          role = COALESCE(${body.role ?? null}::user_role, role),
          staff_id = ${body.staff_id ?? null},
          branches_managed = COALESCE(${body.branches_managed ?? null}, branches_managed),
          active = COALESCE(${body.active ?? null}, active),
          updated_at = now()
      WHERE id = ${body.id}::uuid
    `;
    return { ok: true };
  }

  async deleteUser(id?: string) {
    if (!id) throw new BadRequestException("id is required");
    await db()`UPDATE app_users SET active = false, updated_at = now() WHERE id = ${id}::uuid`;
    return { ok: true };
  }

  async listMapping() {
    const branches = await db()`
      SELECT b.*, dm.name AS dm_name
      FROM branches b
      LEFT JOIN district_managers dm ON dm.id = b.dm_id
      ORDER BY b.id
    `;
    const staff = await db()`
      SELECT s.*, b.name AS branch_name, dm.name AS dm_name
      FROM staff s
      LEFT JOIN branches b ON b.id = s.branch_id
      LEFT JOIN district_managers dm ON dm.id = s.dm_id
      ORDER BY b.id, s.name
    `;
    return { branches, staff };
  }

  async upsertMapping(body: MappingBody) {
    if (!body.branch_id || !body.branch_name || !body.dm_name) {
      throw new BadRequestException("branch_id, branch_name and dm_name are required");
    }
    const branchId = body.branch_id;
    const branchName = body.branch_name;
    const dmName = body.dm_name;
    await db().begin(async (sql) => {
      const key = dmName.trim().split(/\s+/)[0].toLowerCase();
      await sql`
        INSERT INTO district_managers (key, name)
        VALUES (${key}, ${dmName})
        ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
      `;
      const dmRows = await sql`SELECT id FROM district_managers WHERE key = ${key} LIMIT 1`;
      const dmId = dmRows[0].id as number;
      await sql`
        INSERT INTO branches (id, name, dm_id, address, phone, fax, opened, active, updated_at)
        VALUES (${branchId}, ${branchName}, ${dmId}, ${body.address ?? null}, ${body.phone ?? null}, ${body.fax ?? null}, ${body.opened ?? null}, true, now())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name, dm_id = EXCLUDED.dm_id, address = EXCLUDED.address,
          phone = EXCLUDED.phone, fax = EXCLUDED.fax, opened = EXCLUDED.opened,
          active = true, updated_at = now()
      `;
      if (body.staff_name) {
        const username = body.staff_name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
        await sql`
          INSERT INTO staff (name, username, extension, branch_id, dm_id, cdr_aliases, active)
          VALUES (${body.staff_name}, ${username || null}, ${body.extension ?? null}, ${branchId}, ${dmId}, ${body.cdr_aliases ?? [body.staff_name]}, true)
        `;
      }
    });
    return { ok: true };
  }

  async deleteMapping(staffId?: string, branchId?: string) {
    if (staffId) await db()`UPDATE staff SET active = false, updated_at = now() WHERE id = ${staffId}`;
    else if (branchId) await db()`UPDATE branches SET active = false, updated_at = now() WHERE id = ${branchId}`;
    else throw new BadRequestException("staff_id or branch_id is required");
    return { ok: true };
  }

  /**
   * Assign previously-unmapped CDR user names to a branch. For each name we find or
   * create a staff record in that branch (with the name as a cdr_alias), then point
   * the matching unmapped cdr_records rows at it. Future imports resolve by the alias.
   */
  async remapCdrUser(body: { raw_users?: string[]; raw_user?: string; branch_id?: number }) {
    const names = (body.raw_users ?? (body.raw_user ? [body.raw_user] : [])).filter(Boolean);
    const branchId = body.branch_id;
    if (!names.length || !branchId) {
      throw new BadRequestException("raw_users (or raw_user) and branch_id are required");
    }
    const sql = db();
    const branchRows = await sql`SELECT id, dm_id FROM branches WHERE id = ${branchId} LIMIT 1`;
    if (!branchRows.length) throw new BadRequestException("branch not found");
    const dmId = (branchRows[0].dm_id as number | null) ?? null;

    let remapped = 0;
    let mapped = 0;
    await sql.begin(async (tx) => {
      for (const rawUser of names) {
        const existing = await tx`
          SELECT id FROM staff
          WHERE branch_id = ${branchId} AND (name = ${rawUser} OR ${rawUser} = ANY(cdr_aliases))
          LIMIT 1
        `;
        let staffId: number;
        if (existing.length) {
          staffId = existing[0].id as number;
          await tx`
            UPDATE staff
            SET cdr_aliases = (SELECT array(SELECT DISTINCT unnest(cdr_aliases || ARRAY[${rawUser}]::text[]))),
                active = true, updated_at = now()
            WHERE id = ${staffId}
          `;
        } else {
          const username = rawUser.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
          const ins = await tx`
            INSERT INTO staff (name, username, extension, branch_id, dm_id, cdr_aliases, active)
            VALUES (${rawUser}, ${username || null}, ${null}, ${branchId}, ${dmId}, ${[rawUser]}, true)
            RETURNING id
          `;
          staffId = ins[0].id as number;
        }
        const upd = await tx`
          UPDATE cdr_records
          SET staff_id = ${staffId}, branch_id = ${branchId}, dm_id = ${dmId}
          WHERE raw_user_name = ${rawUser} AND staff_id IS NULL AND deleted_at IS NULL
        `;
        remapped += upd.count ?? 0;
        mapped += 1;
        await tx`DELETE FROM ingestion_issues WHERE issue_type = 'unmapped_cdr_user' AND raw_user = ${rawUser}`;
      }
    });
    return { ok: true, names: mapped, remapped };
  }
}
