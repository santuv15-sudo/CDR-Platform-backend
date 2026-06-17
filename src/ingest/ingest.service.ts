import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { db } from "../lib/db";
import { ingestCdr, ingestMapping } from "../lib/ingest";

const ALLOWED = [".csv", ".xlsx", ".xlsm"];

@Injectable()
export class IngestService {
  private assertFile(file: Express.Multer.File | undefined, maxBytes: number) {
    if (!file) throw new BadRequestException("No file provided");
    const name = file.originalname ?? "upload";
    if (!ALLOWED.some((ext) => name.toLowerCase().endsWith(ext))) {
      throw new BadRequestException(`Unsupported file type. Allowed: ${ALLOWED.join(", ")}`);
    }
    if (file.size > maxBytes) throw new PayloadTooLargeException(`File too large (max ${Math.floor(maxBytes / 1024 / 1024)} MB)`);
    return name;
  }

  async ingestMapping(file: Express.Multer.File | undefined, uploadedBy: string) {
    const name = this.assertFile(file, 25 * 1024 * 1024);
    return ingestMapping(file!.buffer, name, file!.mimetype, uploadedBy);
  }

  async ingestCdr(file: Express.Multer.File | undefined, uploadedBy: string) {
    const name = this.assertFile(file, 50 * 1024 * 1024);
    return ingestCdr(file!.buffer, name, file!.mimetype, uploadedBy);
  }

  async batches() {
    return db()`
      SELECT
        b.id, b.kind, b.file_name, b.file_type, b.gcs_path, b.status,
        b.rows_total, b.rows_inserted, b.rows_duplicate, b.rows_unmapped,
        b.rows_failed, b.rows_system, b.error, b.created_at, b.deleted_at,
        u.name AS uploaded_by_name
      FROM ingestion_batches b
      LEFT JOIN app_users u ON u.id = b.uploaded_by
      WHERE b.deleted_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT 100
    `;
  }

  async deletionLog() {
    return db()`
      SELECT d.id, d.batch_id, d.file_name, d.kind, d.rows_archived, d.deleted_at,
             u.name AS deleted_by_name
      FROM deletion_log d
      LEFT JOIN app_users u ON u.id = d.deleted_by
      ORDER BY d.deleted_at DESC
      LIMIT 100
    `;
  }

  async issues(batchId?: string, issueType?: string) {
    return db()`
      SELECT i.*, b.file_name, b.kind
      FROM ingestion_issues i
      LEFT JOIN ingestion_batches b ON b.id = i.batch_id
      WHERE (${batchId ?? null}::uuid IS NULL OR i.batch_id = ${batchId ?? null}::uuid)
        AND (${issueType ?? null}::text IS NULL OR i.issue_type = ${issueType ?? null})
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT 500
    `;
  }

  /**
   * Delete an uploaded batch. The CDR rows are moved into cdr_records_archive
   * (queryable directly in Supabase), then removed from the live table along with
   * their ingestion issues. A row is written to deletion_log so the app can show a
   * deletion audit trail without retaining the deleted records themselves.
   */
  async deleteBatch(batchId: string, deletedBy?: string) {
    let archived = 0;
    await db().begin(async (sql) => {
      const batch = await sql`SELECT file_name, kind FROM ingestion_batches WHERE id = ${batchId}::uuid`;
      const meta = (batch[0] ?? {}) as { file_name?: string; kind?: string };

      const ins = await sql`
        INSERT INTO cdr_records_archive
        SELECT c.*, now(), ${deletedBy ?? null}::uuid
        FROM cdr_records c
        WHERE c.batch_id = ${batchId}::uuid
      `;
      archived = ins.count ?? 0;

      await sql`DELETE FROM cdr_records WHERE batch_id = ${batchId}::uuid`;
      await sql`DELETE FROM ingestion_issues WHERE batch_id = ${batchId}::uuid`;
      await sql`
        INSERT INTO deletion_log (batch_id, file_name, kind, rows_archived, deleted_by)
        VALUES (${batchId}::uuid, ${meta.file_name ?? null}, ${meta.kind ?? null}, ${archived}, ${deletedBy ?? null}::uuid)
      `;
      await sql`DELETE FROM ingestion_batches WHERE id = ${batchId}::uuid`;
    });
    return { ok: true, archived };
  }
}
