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
      ORDER BY b.created_at DESC
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

  async deleteBatch(batchId: string) {
    await db().begin(async (sql) => {
      await sql`UPDATE cdr_records SET deleted_at = now() WHERE batch_id = ${batchId}::uuid`;
      await sql`UPDATE ingestion_batches SET deleted_at = now(), status = 'completed' WHERE id = ${batchId}::uuid`;
    });
    return { ok: true };
  }
}
