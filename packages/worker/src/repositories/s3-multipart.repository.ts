import type { D1Database } from '@cloudflare/workers-types';

/**
 * Data access layer for the `s3_multipart_uploads` and `s3_multipart_parts` tables.
 *
 * Owns all SQL for S3 multipart upload sessions (initiate, upload part, complete, abort).
 * The `deleteUpload` method for orphan cleanup lives in `S3LifecycleRepository` (used by
 * the cron service); this repo is used by the S3 protocol route.
 */
export class S3MultipartRepository {
  constructor(private db: D1Database) {}

  /**
   * Find an upload session by exact workspace match.
   * Used by AbortMultipartUpload (DELETE /:bucket/:key?uploadId).
   */
  findUploadExact(uploadId: string, userId: string, workspaceId: string) {
    return this.db
      .prepare(
        'SELECT * FROM s3_multipart_uploads WHERE upload_id = ? AND user_id = ? AND workspace_id = ?',
      )
      .bind(uploadId, userId, workspaceId)
      .first();
  }

  /**
   * Find an upload session by null-scoped workspace match.
   * Used by CompleteMultipartUpload and UploadPart (POST/PUT with s3WorkspaceId scoping).
   */
  findUploadScoped(uploadId: string, userId: string, s3WorkspaceId: string | null) {
    return this.db
      .prepare(
        `SELECT * FROM s3_multipart_uploads 
         WHERE upload_id = ? AND user_id = ?
           AND (? IS NULL OR workspace_id = ?)`,
      )
      .bind(uploadId, userId, s3WorkspaceId, s3WorkspaceId)
      .first();
  }

  /** Insert a new multipart upload session. */
  insertUpload(params: {
    uploadId: string;
    userId: string;
    workspaceId: string;
    key: string;
    driveAccountId: string;
    tempFolderId: string;
  }) {
    return this.db
      .prepare(
        `INSERT INTO s3_multipart_uploads (upload_id, user_id, workspace_id, key, drive_account_id, temp_folder_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.uploadId,
        params.userId,
        params.workspaceId,
        params.key,
        params.driveAccountId,
        params.tempFolderId,
      )
      .run();
  }

  /** Insert or replace a part for a multipart upload. */
  upsertPart(params: {
    uploadId: string;
    partNumber: number;
    googleFileId: string;
    etag: string;
    size: number;
  }) {
    return this.db
      .prepare(
        'INSERT OR REPLACE INTO s3_multipart_parts (upload_id, part_number, google_file_id, etag, size) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(params.uploadId, params.partNumber, params.googleFileId, params.etag, params.size)
      .run();
  }

  /** Find all parts for an upload, ordered by part number. */
  findPartsByUpload(uploadId: string) {
    return this.db
      .prepare('SELECT * FROM s3_multipart_parts WHERE upload_id = ? ORDER BY part_number ASC')
      .bind(uploadId)
      .all();
  }
}
