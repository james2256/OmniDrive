import type { D1Database } from '@cloudflare/workers-types';

/**
 * Data access layer for the `s3_credentials` table.
 *
 * All SQL for S3 credentials lives here — routes never write inline SQL.
 * Encryption + key generation stays in the route (needs TOKEN_ENCRYPTION_KEY).
 */
export class S3CredentialsRepository {
  constructor(private db: D1Database) {}

  /** Insert a new S3 credential. */
  insert(params: {
    id: string;
    userId: string;
    accessKeyId: string;
    secretKeyEnc: string;
    description: string | null;
    workspaceId: string | null;
  }) {
    return this.db.prepare(
      'INSERT INTO s3_credentials (id, user_id, access_key_id, secret_key_enc, description, workspace_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      params.id, params.userId, params.accessKeyId, params.secretKeyEnc,
      params.description, params.workspaceId,
    ).run();
  }

  /** Find all credentials for a user, with workspace name via LEFT JOIN. */
  findAllByUser(userId: string) {
    return this.db.prepare(
      'SELECT c.id, c.access_key_id, c.description, c.created_at, c.workspace_id, w.name as workspace_name FROM s3_credentials c LEFT JOIN workspaces w ON c.workspace_id = w.id WHERE c.user_id = ?'
    ).bind(userId).all();
  }

  /** Delete a credential. */
  delete(id: string, userId: string) {
    return this.db.prepare('DELETE FROM s3_credentials WHERE id = ? AND user_id = ?')
      .bind(id, userId).run();
  }
}
