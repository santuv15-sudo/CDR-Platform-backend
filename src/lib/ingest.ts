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

const ANSWERED_TOKENS = new Set([
  "answered",
  "answer",
  "connected",
  "connect",
  "yes",
  "y",
  "true",
  "1",
  "answered after disposition",
]);

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

  let failed = 0;
  let system = 0;
  let unmapped = 0;
  const issues: Array<{ type: string; severity?: string; rowNumber?: number; rawUser?: string; message: string; payload?: unknown }> = [];
  const now = new Date().toISOString();

  const payloads = rows.flatMap((r, index) => {
    let userVal = cell(r, cols.user);
    const direction = normalizeDirection(cell(r, cols.direction));
    if (!direction) {
      failed++;
      issues.push({
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
    if (userVal && isSystemUser(userVal)) {
      system++;
      issues.push({
        type: "system_cdr_row",
        severity: "low",
        rowNumber: index + 2,
        rawUser: userVal,
        message: "System or hunt-group row skipped.",
        payload: issuePayload(r),
      });
      return [];
    }

    const staff = findStaff(userVal, direction === "Inbound" ? called ?? "" : calling ?? "", staffRows);
    if (!staff) {
      unmapped++;
      issues.push({
        type: "unmapped_cdr_user",
        severity: "high",
        rowNumber: index + 2,
        rawUser: userVal || "(blank)",
        message: "CDR user could not be mapped to active staff.",
        payload: issuePayload(r),
      });
    }

    const sourceDate = cell(r, cols.source_file).slice(0, 10) || fileName.slice(0, 10);
    const callDate = normalizeDateString(cell(r, cols.date)) ?? normalizeDateString(sourceDate);
    const timeVal = cell(r, cols.time) || null;
    const hour = timeVal && /^\d{1,2}:/.test(timeVal) ? Number.parseInt(timeVal.split(":")[0], 10) : null;
    const answered = ANSWERED_TOKENS.has(norm(cell(r, cols.answered)));
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
      branch_id: staff?.branch_id ?? null,
      dm_id: staff?.dm_id ?? null,
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
  try {
    for (const row of payloads) {
      const result = await sql`
        INSERT INTO cdr_records (
          call_date, call_time, direction, call_result, answered, duration_secs, hour,
          calling_tn, called_tn, staff_id, branch_id, dm_id, source_file, batch_id,
          raw_user_name, caller_id_name, local_call_id, remote_call_id, raw_payload,
          dedup_key, ingested_at
        )
        VALUES (
          ${row.call_date}::date, ${row.call_time}, ${row.direction}::call_direction, ${row.call_result},
          ${row.answered}, ${row.duration_secs}, ${row.hour},
          ${row.calling_tn}, ${row.called_tn}, ${row.staff_id}, ${row.branch_id}, ${row.dm_id},
          ${row.source_file}, ${row.batch_id}::uuid, ${row.raw_user_name}, ${row.caller_id_name},
          ${row.local_call_id}, ${row.remote_call_id}, ${JSON.stringify(row.raw_payload)}::jsonb,
          ${row.dedup_key}, ${row.ingested_at}
        )
        ON CONFLICT (dedup_key) DO NOTHING
        RETURNING id
      `;
      if (result.length) inserted++;
      else {
        duplicates++;
        issues.push({
          type: "duplicate_cdr_row",
          severity: "medium",
          rawUser: row.raw_user_name ?? undefined,
          message: "Duplicate CDR row skipped.",
          payload: { dedup_key: row.dedup_key, source_file: fileName },
        });
      }
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
