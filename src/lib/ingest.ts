import { createHash, randomUUID } from "node:crypto";
import { db } from "./db";
import { parseDurationToSecs } from "./duration";
import { uploadBytes } from "./gcs";
import {
  CDR_HEADER_KEYWORDS,
  MAPPING_HEADER_KEYWORDS,
  cell,
  detectColumns,
  isSystemUser,
  norm,
  normalizeDateString,
  normalizeDirection,
  phoneDigits,
  readRows,
} from "./ingest-helpers";

const ANSWERED_TOKENS = new Set(["yes", "y", "true", "1"]);

/**
 * A call counts as answered when the Answer Indicator is an affirmative value.
 * The provider emits compound values like "Yes-PostRedirection" / "Yes-Direct" and
 * "Answered After Disposition", so we prefix-match rather than require an exact token.
 */
function isAnswered(value: string): boolean {
  const v = norm(value);
  if (!v) return false;
  if (v.startsWith("yes") || v.startsWith("answer") || v.startsWith("connect")) return true;
  return ANSWERED_TOKENS.has(v);
}

export { parseDurationToSecs } from "./duration";
export {
  CDR_HEADER_KEYWORDS,
  MAPPING_HEADER_KEYWORDS,
  detectColumns,
  isSystemUser,
  normalizeDateString,
  normalizeDirection,
  readRows,
} from "./ingest-helpers";

function dmKey(name: string): string {
  return norm(name).split(" ")[0] || "unknown";
}

function dedupKey(...parts: unknown[]): string {
  return createHash("sha256").update(parts.map((p) => (p ?? "")).join("|")).digest("hex");
}

function issuePayload(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).slice(0, 50));
}

export interface IngestResult {
  batch_id: string;
  file_name: string;
  rows_total: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_unmapped: number;
  rows_failed?: number;
  rows_system?: number;
  status: string;
}

async function createBatch(kind: string, fileName: string, contentType: string, buf: Buffer, uploadedBy: string) {
  const batchId = randomUUID();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "csv";
  const dest = `${kind}/${new Date().toISOString().slice(0, 10)}/${batchId}_${fileName}`;
  const gcsPath = await uploadBytes(buf, dest, contentType || "application/octet-stream");
  await db()`
    INSERT INTO ingestion_batches (id, kind, file_name, file_type, gcs_path, status, uploaded_by, created_at)
    VALUES (${batchId}::uuid, ${kind}, ${fileName}, ${ext}, ${gcsPath}, 'processing', ${uploadedBy}::uuid, now())
  `;
  return batchId;
}

async function finishBatch(batchId: string, result: IngestResult) {
  await db()`
    UPDATE ingestion_batches
    SET status = ${result.status}::ingest_status,
        rows_total = ${result.rows_total},
        rows_inserted = ${result.rows_inserted},
        rows_duplicate = ${result.rows_duplicate},
        rows_unmapped = ${result.rows_unmapped},
        rows_failed = ${result.rows_failed ?? 0},
        rows_system = ${result.rows_system ?? 0}
    WHERE id = ${batchId}::uuid
  `;
}

async function failBatch(batchId: string, message: string) {
  await db()`UPDATE ingestion_batches SET status = 'failed', error = ${message} WHERE id = ${batchId}::uuid`;
}

async function insertIssues(
  batchId: string,
  issues: Array<{ type: string; severity?: string; rowNumber?: number; rawUser?: string; message: string; payload?: unknown }>,
) {
  if (!issues.length) return;
  const sql = db();
  for (const issue of issues) {
    await sql`
      INSERT INTO ingestion_issues (batch_id, issue_type, severity, row_number, raw_user, message, payload)
      VALUES (
        ${batchId}::uuid,
        ${issue.type},
        ${issue.severity ?? "medium"},
        ${issue.rowNumber ?? null},
        ${issue.rawUser ?? null},
        ${issue.message},
        ${JSON.stringify(issue.payload ?? {})}::jsonb
      )
    `;
  }
}

export async function ingestMapping(
  buf: Buffer,
  fileName: string,
  contentType: string,
  uploadedBy: string,
): Promise<IngestResult> {
  const rows = await readRows(buf, fileName);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const cols = detectColumns(headers, MAPPING_HEADER_KEYWORDS);
  const missing = ["branch_name", "dm_name"].filter((k) => !cols[k]);
  if (missing.length) {
    const err = new Error(`Missing mapping column(s): ${missing.join(", ")}. Found: ${headers.join(", ")}`);
    (err as Error & { status?: number }).status = 422;
    throw err;
  }

  const batchId = await createBatch("mapping", fileName, contentType, buf, uploadedBy);
  const sql = db();
  const issues: Array<{ type: string; severity?: string; rowNumber?: number; rawUser?: string; message: string; payload?: unknown }> = [];
  let inserted = 0;
  let failed = 0;

  try {
    await sql.begin(async (tx) => {
      await tx`UPDATE staff SET active = false, updated_at = now()`;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        const branchName = cell(row, cols.branch_name);
        const dmName = cell(row, cols.dm_name);
        if (!branchName || !dmName) {
          failed++;
          issues.push({
            type: "invalid_mapping_row",
            severity: "high",
            rowNumber: index + 2,
            message: "Mapping row is missing branch name or district manager.",
            payload: issuePayload(row),
          });
          continue;
        }

        const parsedBranchId = Number.parseInt(cell(row, cols.branch_id), 10);
        const branchId = Number.isFinite(parsedBranchId) && parsedBranchId > 0 ? parsedBranchId : null;
        const key = dmKey(dmName);
        await tx`
          INSERT INTO district_managers (key, name)
          VALUES (${key}, ${dmName})
          ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name
        `;
        const dmRows = await tx`SELECT id FROM district_managers WHERE key = ${key} LIMIT 1`;
        const dmId = dmRows[0].id as number;

        let finalBranchId = branchId;
        if (!finalBranchId) {
          const existing = await tx`SELECT id FROM branches WHERE lower(name) = lower(${branchName}) LIMIT 1`;
          finalBranchId = (existing[0]?.id as number | undefined) ?? null;
        }
        if (!finalBranchId) {
          const nextRows = await tx`SELECT COALESCE(max(id), 0) + 1 AS id FROM branches`;
          finalBranchId = nextRows[0].id as number;
        }

        await tx`
          INSERT INTO branches (id, name, dm_id, address, phone, fax, opened, active, updated_at)
          VALUES (
            ${finalBranchId}, ${branchName}, ${dmId}, ${cell(row, cols.address) || null},
            ${cell(row, cols.phone) || null}, ${cell(row, cols.fax) || null},
            ${cell(row, cols.opened) || null}, true, now()
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            dm_id = EXCLUDED.dm_id,
            address = EXCLUDED.address,
            phone = EXCLUDED.phone,
            fax = EXCLUDED.fax,
            opened = EXCLUDED.opened,
            active = true,
            updated_at = now()
        `;

        const staffName = cell(row, cols.staff_name);
        const extension = cell(row, cols.extension);
        const cdrName = cell(row, cols.cdr_name);
        if (staffName && !/^open desk$/i.test(staffName)) {
          const username = norm(staffName).replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
          const existing = extension
            ? await tx`SELECT id, cdr_aliases FROM staff WHERE branch_id = ${finalBranchId} AND extension = ${extension} LIMIT 1`
            : await tx`SELECT id, cdr_aliases FROM staff WHERE branch_id = ${finalBranchId} AND lower(name) = lower(${staffName}) LIMIT 1`;
          const aliases = Array.from(new Set([staffName, cdrName].filter(Boolean)));
          if (existing.length) {
            const currentAliases = (existing[0].cdr_aliases as string[] | null) ?? [];
            await tx`
              UPDATE staff
              SET name = ${staffName},
                  username = ${username || null},
                  extension = ${extension || null},
                  branch_id = ${finalBranchId},
                  dm_id = ${dmId},
                  cdr_aliases = ${Array.from(new Set([...currentAliases, ...aliases]))},
                  active = true,
                  updated_at = now()
              WHERE id = ${existing[0].id}
            `;
          } else {
            await tx`
              INSERT INTO staff (name, username, extension, branch_id, dm_id, cdr_aliases, active)
              VALUES (${staffName}, ${username || null}, ${extension || null}, ${finalBranchId}, ${dmId}, ${aliases}, true)
            `;
          }
        }
        inserted++;
      }
    });
    await insertIssues(batchId, issues);
  } catch (e) {
    await failBatch(batchId, (e as Error).message);
    throw e;
  }

  const result = {
    batch_id: batchId,
    file_name: fileName,
    rows_total: rows.length,
    rows_inserted: inserted,
    rows_duplicate: 0,
    rows_unmapped: 0,
    rows_failed: failed,
    status: failed ? "completed" : "completed",
  };
  await finishBatch(batchId, result);
  return result;
}

interface StaffMatch {
  id: number;
  name: string;
  extension: string | null;
  branch_id: number | null;
  dm_id: number | null;
  cdr_aliases: string[] | null;
}

function findStaff(userName: string, extension: string, staffRows: StaffMatch[]): StaffMatch | null {
  const normalizedUser = norm(userName);
  if (normalizedUser) {
    const byName = staffRows.find((s) => norm(s.name) === normalizedUser);
    if (byName) return byName;
    const byAlias = staffRows.find((s) => (s.cdr_aliases ?? []).some((a) => norm(a) === normalizedUser));
    if (byAlias) return byAlias;
  }
  const digits = phoneDigits(extension);
  if (digits) {
    for (let len = Math.min(7, digits.length); len >= 3; len--) {
      const suffix = digits.slice(-len);
      const byExt = staffRows.find((s) => phoneDigits(s.extension).endsWith(suffix));
      if (byExt) return byExt;
    }
  }
  return null;
}

export async function ingestCdr(
  buf: Buffer,
  fileName: string,
  contentType: string,
  uploadedBy: string,
): Promise<IngestResult> {
  const sql = db();
  const hasMapping = await sql`SELECT id FROM staff WHERE active = true LIMIT 1`;
  if (!hasMapping.length) {
    const err = new Error("Load a branch/staff mapping CSV before importing CDR records.");
    (err as Error & { status?: number }).status = 409;
    throw err;
  }

  const rows = await readRows(buf, fileName);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const cols = detectColumns(headers, CDR_HEADER_KEYWORDS);
  if (!cols.direction) {
    const err = new Error(`Missing required CDR column: direction. Found: ${headers.join(", ")}`);
    (err as Error & { status?: number }).status = 422;
    throw err;
  }

  const batchId = await createBatch("cdr", fileName, contentType, buf, uploadedBy);
  const staffRows = (await sql`
    SELECT id, name, extension, branch_id, dm_id, cdr_aliases
    FROM staff
    WHERE active = true
  `) as StaffMatch[];

  // Branch directory used to resolve hunt-group / auto-attendant rows to a branch.
  const branchRows = (await sql`SELECT id, name, dm_id FROM branches WHERE active = true`) as { id: number; name: string; dm_id: number | null }[];
  const branchByNorm = branchRows.map((b) => ({ id: b.id, name: b.name, dm_id: b.dm_id, norm: norm(b.name).replace(/\s+/g, "") }));
  const branchById = new Map<number, { id: number; name: string; dm_id: number | null }>(branchRows.map((b) => [b.id, b]));

  let failed = 0;
  let system = 0;
  let unmapped = 0;
  type Issue = { type: string; severity?: string; rowNumber?: number; rawUser?: string; message: string; payload?: unknown };
  const issues: Issue[] = [];
  // Keep the stored diagnostics bounded. A large CDR file can have tens of thousands
  // of skipped/unmapped rows; retaining a full row payload for every one of them
  // exhausts memory. We still count every row accurately (failed/system/unmapped),
  // but only persist a capped sample of issue detail.
  const ISSUE_CAP = 2000;
  const pushIssue = (i: Issue) => { if (issues.length < ISSUE_CAP) issues.push(i); };
  const now = new Date().toISOString();

  const payloads = rows.flatMap((r, index) => {
    let userVal = cell(r, cols.user);
    const direction = normalizeDirection(cell(r, cols.direction));
    if (!direction) {
      failed++;
      pushIssue({
        type: "invalid_cdr_row",
        severity: "high",
        rowNumber: index + 2,
        rawUser: userVal || undefined,
        message: "CDR row has no recognizable direction.",
        payload: issuePayload(r),
      });
      return [];
    }

    const calling = cell(r, cols.calling_tn) || null;
    const called = cell(r, cols.called_tn) || null;
    if (!userVal) {
      userVal = direction === "Inbound" ? phoneDigits(called).slice(-7) : phoneDigits(calling).slice(-7);
    }
    // Hunt Group / Auto Attendant / Main rows: resolve to an agent or branch before
    // discarding, mirroring the dashboard logic — (1) Answered-By-Extension -> agent,
    // (2) branch name contained in the group name -> branch, (3) Called-TN extension ->
    // that agent's branch, (4) synthetic HG-Seat from any phone number. Skip only when
    // there is no usable phone number at all.
    let resolvedStaff: StaffMatch | null = null;
    let hgBranchId: number | null = null;
    let hgDmId: number | null = null;
    if (userVal && isSystemUser(userVal)) {
      resolvedStaff = findStaff("", cell(r, cols.answered_ext), staffRows);
      if (!resolvedStaff) {
        const hgL = norm(userVal).replace(/\s+/g, "");
        const b = branchByNorm.find((x) => x.norm.length >= 3 && hgL.includes(x.norm));
        if (b) { hgBranchId = b.id; hgDmId = b.dm_id; userVal = `HG-${b.name}`; }
      }
      if (!resolvedStaff && hgBranchId === null) {
        const s = findStaff("", called ?? "", staffRows);
        if (s) {
          hgBranchId = s.branch_id;
          hgDmId = s.dm_id;
          userVal = `HG-${(s.branch_id != null && branchById.get(s.branch_id)?.name) || s.branch_id}`;
        }
      }
      if (!resolvedStaff && hgBranchId === null) {
        const tnFb = phoneDigits(called) || phoneDigits(calling);
        if (tnFb) {
          userVal = `HG-Seat-${tnFb.slice(-5)}`;
        } else {
          system++;
          pushIssue({
            type: "system_cdr_row",
            severity: "low",
            rowNumber: index + 2,
            rawUser: userVal,
            message: "System/hunt-group row with no phone number skipped.",
            payload: issuePayload(r),
          });
          return [];
        }
      }
    }

    // Hunt Group: any CDR user name starting with "Hunt", or a synthetic "HG-Seat" /
    // "HG Seat" hunt-group seat row, rolls up to the Hunt Group. Prefer the "Hunt Group"
    // staff so the calls carry an agent; otherwise fall back to just the "Hunt" branch.
    if (!resolvedStaff && hgBranchId === null && userVal && /^(hunt|hg[-\s]?(seat|hunt))/i.test(userVal.trim())) {
      const hgStaff = staffRows.find((s) => norm(s.name) === "hunt group");
      if (hgStaff) {
        resolvedStaff = hgStaff;
      } else {
        const hb = branchByNorm.find((x) => x.norm === "hunt");
        if (hb) { hgBranchId = hb.id; hgDmId = hb.dm_id; }
      }
    }

    let staff = resolvedStaff ?? (hgBranchId === null
      ? findStaff(userVal, direction === "Inbound" ? called ?? "" : calling ?? "", staffRows)
      : null);

    // Numbered-name fallback: a still-unmapped CDR name ending in One/Two/Three/Four/Five
    // that contains a branch name maps to the agent at that branch's matching position
    // extension (e.g. "Cicero5303Cermak Two" -> Cicero's …2 extension agent). Mirrors the
    // spreadsheet's position-to-extension convention. Known names still resolve by alias above.
    if (!staff && hgBranchId === null && userVal) {
      const pm = userVal.trim().match(/(one|two|three|four|five)\s*$/i);
      if (pm) {
        const posMap: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
        const posn = posMap[pm[1].toLowerCase()];
        const un = norm(userVal).replace(/\s+/g, "");
        const br = branchByNorm.find((x) => x.norm.length >= 3 && un.includes(x.norm));
        if (br) {
          const agents = staffRows.filter((s) => s.branch_id === br.id && /^\d{5}$/.test(s.extension ?? "") && norm(s.name) !== "main");
          const counts = new Map<string, number>();
          for (const s of agents) { const p = (s.extension ?? "").slice(0, 4); counts.set(p, (counts.get(p) ?? 0) + 1); }
          let pref = "", best = 0;
          for (const [p, c] of counts) if (c > best) { best = c; pref = p; }
          const ag = pref ? agents.find((s) => s.extension === pref + String(posn)) : undefined;
          if (ag) staff = ag;
          else { hgBranchId = br.id; hgDmId = br.dm_id; }
        }
      }
    }

    if (!staff && hgBranchId === null) {
      unmapped++;
      pushIssue({
        type: "unmapped_cdr_user",
        severity: "high",
        rowNumber: index + 2,
        rawUser: userVal || "(blank)",
        message: "CDR user could not be mapped to active staff.",
        payload: issuePayload(r),
      });
    }

    // Hard rule: any CDR name containing both "4333" and "Kedzie" belongs to Archer,
    // overriding the branch from normal resolution (the matched staff_id is preserved).
    let forceBranchId: number | null = null, forceDmId: number | null = null;
    if (userVal && /4333/.test(userVal) && /kedzie/i.test(userVal)) {
      const ar = branchByNorm.find((x) => x.norm === "archer");
      if (ar) { forceBranchId = ar.id; forceDmId = ar.dm_id; }
    }

    const sourceDate = cell(r, cols.source_file).slice(0, 10) || fileName.slice(0, 10);
    const callDate = normalizeDateString(cell(r, cols.date)) ?? normalizeDateString(sourceDate);
    const timeVal = cell(r, cols.time) || null;
    const hour = timeVal && /^\d{1,2}:/.test(timeVal) ? Number.parseInt(timeVal.split(":")[0], 10) : null;
    const answered = isAnswered(cell(r, cols.answered));
    const dur = parseDurationToSecs(cell(r, cols.duration));
    const localCallId = cell(r, cols.local_call_id) || null;
    const remoteCallId = cell(r, cols.remote_call_id) || null;
    const dedupParts = localCallId || remoteCallId
      ? [localCallId, remoteCallId, direction]
      : [userVal, direction, callDate, timeVal, dur, calling, called];

    return [{
      call_date: callDate,
      call_time: timeVal,
      direction,
      call_result: cell(r, cols.call_result) || null,
      answered,
      duration_secs: dur,
      hour: Number.isFinite(hour) ? hour : null,
      calling_tn: calling,
      called_tn: called,
      staff_id: staff?.id ?? null,
      branch_id: forceBranchId ?? staff?.branch_id ?? hgBranchId ?? null,
      dm_id: forceDmId ?? staff?.dm_id ?? hgDmId ?? null,
      source_file: fileName,
      batch_id: batchId,
      raw_user_name: userVal || null,
      caller_id_name: cell(r, cols.caller_id_name) || null,
      local_call_id: localCallId,
      remote_call_id: remoteCallId,
      raw_payload: issuePayload(r),
      dedup_key: dedupKey(...dedupParts),
      ingested_at: now,
    }];
  });

  let inserted = 0;
  let duplicates = 0;

  // De-duplicate within the file by dedup_key first: a single multi-row INSERT
  // cannot tolerate the same ON CONFLICT key appearing twice in one statement.
  const seen = new Set<string>();
  const unique = payloads.filter((row) => {
    if (seen.has(row.dedup_key)) { duplicates++; return false; }
    seen.add(row.dedup_key);
    return true;
  });

  // Bulk insert in chunks. Each chunk is sent as a single JSON parameter and
  // expanded server-side via json_to_recordset — one round-trip per ~2000 rows
  // instead of one per row, which is what makes a 100k+ row file feasible.
  const CHUNK = 5000;
  try {
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const result = await sql`
        INSERT INTO cdr_records (
          call_date, call_time, direction, call_result, answered, duration_secs, hour,
          calling_tn, called_tn, staff_id, branch_id, dm_id, source_file, batch_id,
          raw_user_name, caller_id_name, local_call_id, remote_call_id, raw_payload,
          dedup_key, ingested_at
        )
        SELECT
          x.call_date::date, x.call_time, x.direction::call_direction, x.call_result,
          x.answered, x.duration_secs, x.hour,
          x.calling_tn, x.called_tn, x.staff_id, x.branch_id, x.dm_id,
          x.source_file, x.batch_id::uuid, x.raw_user_name, x.caller_id_name,
          x.local_call_id, x.remote_call_id, x.raw_payload,
          x.dedup_key, x.ingested_at::timestamptz
        FROM jsonb_to_recordset(${sql.json(chunk as never)}) AS x(
          call_date text, call_time text, direction text, call_result text, answered boolean,
          duration_secs int, hour int, calling_tn text, called_tn text, staff_id int,
          branch_id int, dm_id int, source_file text, batch_id text, raw_user_name text,
          caller_id_name text, local_call_id text, remote_call_id text, raw_payload jsonb,
          dedup_key text, ingested_at text
        )
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING dedup_key
      `;
      inserted += result.length;
      duplicates += chunk.length - result.length;
    }
    await insertIssues(batchId, issues);
  } catch (e) {
    const msg = (e as Error).message;
    await failBatch(batchId, msg);
    const err = new Error(`Insert failed: ${msg}`);
    (err as Error & { status?: number }).status = 500;
    throw err;
  }

  const result: IngestResult = {
    batch_id: batchId,
    file_name: fileName,
    rows_total: rows.length,
    rows_inserted: inserted,
    rows_duplicate: duplicates,
    rows_unmapped: unmapped,
    rows_failed: failed,
    rows_system: system,
    status: "completed",
  };
  await finishBatch(batchId, result);
  return result;
}
