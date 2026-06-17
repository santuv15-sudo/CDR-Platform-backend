import { env } from "./env";

/** Upload bytes to GCS. No-op (returns local:// uri) when GCS_BUCKET is unset. */
export async function uploadBytes(
  data: Buffer, destPath: string, contentType: string,
): Promise<string> {
  const bucketName = env.gcsBucket();
  if (!bucketName) return `local://${destPath}`;
  try {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage({ projectId: env.gcpProject() || undefined });
    const file = storage.bucket(bucketName).file(destPath);
    await file.save(data, { contentType, resumable: false });
    return `gs://${bucketName}/${destPath}`;
  } catch (err) {
    // Raw-file archiving to GCS is best-effort: never fail ingestion because the
    // bucket is missing or credentials aren't configured. Fall back to a local marker.
    console.warn(`[gcs] archive skipped (${(err as Error).message}); continuing without GCS`);
    return `local://${destPath}`;
  }
}
