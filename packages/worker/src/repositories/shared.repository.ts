import type { D1Database } from '@cloudflare/workers-types';
import { generateId } from '../lib/id';
import type { SharedLinkRow } from '../types/db';

/**
 * Data access layer for `shared_links` and `shared_link_logs` tables.
 *
 * All SQL for shared links lives here — routes and services never write
 * inline SQL. The repository owns the unique-slug generation retry loop
 * so the service doesn't deal with D1 UNIQUE constraint errors.
 */
export class SharedRepository {
  constructor(private db: D1Database) {}

  // ─── Reads ───

  /** Find a shared link by ID (no user filter — used by public routes). */
  findById(id: string): Promise<SharedLinkRow | null> {
    return this.db
      .prepare('SELECT * FROM shared_links WHERE id = ?')
      .bind(id)
      .first<SharedLinkRow>();
  }

  /** Find a shared link by ID + user (for management endpoints). */
  findByIdAndUser(id: string, userId: string): Promise<SharedLinkRow | null> {
    return this.db
      .prepare('SELECT * FROM shared_links WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<SharedLinkRow>();
  }

  /** List all shared links for a user. target_name + target_mime_type are
   * denormalized onto the row (set at creation time, not updated on rename).
   * Eliminates the previous 3-table JOIN (files + workspace_folders + drive_folders). */
  findAllByUserWithTargetName(userId: string) {
    return this.db
      .prepare('SELECT * FROM shared_links WHERE user_id = ?')
      .bind(userId)
      .all<Record<string, unknown>>();
  }

  /** Resolve a folder's name by ID (checks both workspace_folders and drive_folders). */
  async findFolderName(folderId: string): Promise<string | null> {
    const row = await this.db
      .prepare(
        `
      SELECT name FROM (
        SELECT name FROM workspace_folders WHERE id = ?
        UNION ALL
        SELECT name FROM drive_folders WHERE google_folder_id = ?
      ) LIMIT 1
    `,
      )
      .bind(folderId, folderId)
      .first<{ name: string }>();
    return row?.name ?? null;
  }

  // ─── Mutations ───

  /**
   * Insert a shared link with a random 16-char slug.
   * Retries on UNIQUE constraint failure (collision on 64-bit entropy is
   * astronomically rare but handled deterministically).
   * Returns the generated ID, or throws if all attempts collide.
   */
  async insertWithUniqueSlug(params: {
    userId: string;
    targetType: 'file' | 'folder';
    targetId: string;
    targetName: string | null;
    targetMimeType: string | null;
    passwordHash: string | null;
    expiresAt: string | null;
    allowDownloads: boolean;
    allowUploads: boolean;
    maxDownloads: number | null;
    requireEmail: boolean;
    webhookUrl: string | null;
  }): Promise<string> {
    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i++) {
      const id = generateId().replace(/-/g, '').slice(0, 16);
      try {
        await this.db
          .prepare(
            'INSERT INTO shared_links (id, user_id, target_type, target_id, target_name, target_mime_type, password_hash, expires_at, allow_downloads, allow_uploads, max_downloads, require_email, webhook_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            id,
            params.userId,
            params.targetType,
            params.targetId,
            params.targetName,
            params.targetMimeType,
            params.passwordHash,
            params.expiresAt,
            params.allowDownloads ? 1 : 0,
            params.allowUploads ? 1 : 0,
            params.maxDownloads,
            params.requireEmail ? 1 : 0,
            params.webhookUrl,
          )
          .run();
        return id;
      } catch (e: unknown) {
        if (!(e instanceof Error && e.message.includes('UNIQUE constraint failed'))) {
          throw e; // Re-throw non-collision errors (e.g., FK violation)
        }
      }
    }
    throw new Error('Could not generate unique shared link ID after 3 attempts');
  }

  /** Update a shared link. Caller computes the field values. Returns rows changed. */
  async update(
    id: string,
    userId: string,
    fields: {
      expiresAt: string | null;
      allowDownloads: boolean;
      allowUploads: boolean;
      maxDownloads: number | null;
      requireEmail: boolean;
      webhookUrl: string | null;
      passwordHash: string | null;
    },
  ): Promise<number> {
    const r = await this.db
      .prepare(
        'UPDATE shared_links SET expires_at = ?, allow_downloads = ?, allow_uploads = ?, max_downloads = ?, require_email = ?, webhook_url = ?, password_hash = ? WHERE id = ? AND user_id = ?',
      )
      .bind(
        fields.expiresAt,
        fields.allowDownloads ? 1 : 0,
        fields.allowUploads ? 1 : 0,
        fields.maxDownloads,
        fields.requireEmail ? 1 : 0,
        fields.webhookUrl,
        fields.passwordHash,
        id,
        userId,
      )
      .run();
    return r.meta.changes;
  }

  /**
   * Delete a shared link with manual cascade. Production D1 enforces FK +
   * ON DELETE CASCADE by default (developers.cloudflare.com/d1/sql-api/foreign-keys),
   * so the batch is redundant in production but defensive: it ensures correct
   * behavior on runtimes that don't enforce FK (better-sqlite3-based runtimes —
   * unit tests and the node-server Docker deployment — do not enable
   * PRAGMA foreign_keys) and survives any schema change that drops the FK.
   *
   * Cascade order (children before parents):
   * 1. shared_link_logs (shared_link_id FK)
   * 2. shared_links (the row itself)
   *
   * Uses db.batch() for atomicity (single round-trip).
   */
  async delete(id: string, userId: string) {
    await this.db.batch([
      this.db.prepare('DELETE FROM shared_link_logs WHERE shared_link_id = ?').bind(id),
      this.db.prepare('DELETE FROM shared_links WHERE id = ? AND user_id = ?').bind(id, userId),
    ]);
  }

  // ─── Counters ───

  /** Increment view count. Non-blocking — caller wraps in waitUntil. */
  incrementViewCount(id: string) {
    return this.db
      .prepare('UPDATE shared_links SET view_count = view_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  /** Increment download count (no limit check). Non-blocking — caller wraps in waitUntil. */
  incrementDownloadCount(id: string) {
    return this.db
      .prepare('UPDATE shared_links SET download_count = download_count + 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  /**
   * Atomically increment download count, enforcing maxDownloads limit.
   * Returns the new count if allowed, null if limit reached or link missing.
   * Call BEFORE streaming — not in waitUntil. NOTE: because the increment
   * commits before the stream starts, a failed stream STILL burns the count.
   * This is intentional: moving the increment after the stream would
   * introduce a TOCTOU race (concurrent requests all pass the check before
   * any increment) and a disconnect-abuse vector. The trade-off: a network
   * blip costs one download attempt.
   */
  async incrementDownloadCountWithLimit(id: string): Promise<number | null> {
    const r = await this.db
      .prepare(
        'UPDATE shared_links SET download_count = download_count + 1 WHERE id = ? AND (max_downloads IS NULL OR download_count < max_downloads) RETURNING download_count',
      )
      .bind(id)
      .first<{ download_count: number }>();
    return r ? r.download_count : null;
  }

  // ─── Audit logs ───

  /** Log a shared-link action (view, download, email_access). */
  logAction(sharedLinkId: string, action: string, visitorEmail?: string) {
    return this.db
      .prepare(
        'INSERT INTO shared_link_logs (shared_link_id, action, visitor_email) VALUES (?, ?, ?)',
      )
      .bind(sharedLinkId, action, visitorEmail ?? null)
      .run();
  }
}
