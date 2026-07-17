import type { D1Database } from '@cloudflare/workers-types';
import type { OAuthTokens, QuotaCache } from '../types/index';
import { parseStorageQuota, QUOTA_CACHE_VERSION } from '../lib/storage-quota';

const QUOTA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GDriveOwner {
  me: boolean;
  displayName?: string;
}

export interface GDriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  parents?: string[];
  trashed?: boolean;
  owners?: GDriveOwner[];
  thumbnailLink?: string;
  webViewLink?: string;
  webContentLink?: string;
  createdTime: string;
  modifiedTime: string;
  md5Checksum?: string;
}

export interface GDriveFolder {
  id: string;
  name: string;
  parents?: string[];
  owners?: GDriveOwner[];
}

export class GoogleDriveError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
    this.name = 'GoogleDriveError';
  }
}

export class GoogleDriveService {
  private encryptionKey?: string;
  // In-memory token cache — avoids a D1 read (loadTokens) on every page of a sync.
  // Scoped to this instance: one GoogleDriveService per sync invocation, so the cache
  // lives only as long as needed and never serves cross-invocation stale tokens.
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

  constructor(
    private db: D1Database,
    private clientId: string,
    private clientSecret: string,
    encryptionKey?: string
  ) {
    this.encryptionKey = encryptionKey;
  }

  // ─── Token Management ───

  private async loadTokens(driveAccountId: string): Promise<OAuthTokens> {
    const row = await this.db.prepare('SELECT encrypted_tokens FROM drive_tokens WHERE drive_account_id = ?')
      .bind(driveAccountId).first<{ encrypted_tokens: string }>();
    if (!row?.encrypted_tokens) throw new Error(`No tokens found for drive ${driveAccountId}`);

    let tokensJson = row.encrypted_tokens;
    if (this.encryptionKey) {
      const { decryptOrPassthrough } = await import('../lib/crypto');
      tokensJson = await decryptOrPassthrough(row.encrypted_tokens, this.encryptionKey);
    }
    return JSON.parse(tokensJson) as OAuthTokens;
  }

  async getValidToken(driveAccountId: string): Promise<string> {
    // Cache hit: skip the D1 read entirely. The cache checks expiry with the same
    // 60-second margin as the refresh logic below, so it never serves stale tokens.
    const cached = this.tokenCache.get(driveAccountId);
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token;
    }

    const tokens = await this.loadTokens(driveAccountId);
    if (tokens.authType === 'service_account' && tokens.serviceAccount) {
      if (tokens.expiresAt > Date.now() + 60_000) {
        this.tokenCache.set(driveAccountId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
        return tokens.accessToken;
      }
      const refreshed = await this.refreshServiceAccountToken(driveAccountId, tokens);
      this.tokenCache.set(driveAccountId, { token: refreshed, expiresAt: tokens.expiresAt });
      return refreshed;
    }
    if (tokens.expiresAt > Date.now() + 60_000) {
      this.tokenCache.set(driveAccountId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      throw new Error(`No refresh token for drive ${driveAccountId}`);
    }
    const refreshed = await this.refreshToken(driveAccountId, tokens.refreshToken);
    this.tokenCache.set(driveAccountId, { token: refreshed, expiresAt: tokens.expiresAt });
    return refreshed;
  }

  private async persistTokens(driveAccountId: string, tokens: OAuthTokens): Promise<void> {
    const serialized = JSON.stringify(tokens);
    const encryptedTokens = this.encryptionKey
      ? await (await import('../lib/crypto')).encrypt(serialized, this.encryptionKey)
      : serialized;
    await this.db.prepare(
      'INSERT INTO drive_tokens (drive_account_id, encrypted_tokens, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(drive_account_id) DO UPDATE SET encrypted_tokens = excluded.encrypted_tokens, updated_at = excluded.updated_at'
    ).bind(driveAccountId, encryptedTokens, Date.now()).run();
  }

  private async refreshServiceAccountToken(
    driveAccountId: string,
    tokens: OAuthTokens
  ): Promise<string> {
    if (!tokens.serviceAccount) {
      throw new Error(`No service account credentials for drive ${driveAccountId}`);
    }
    const { fetchServiceAccountAccessToken } = await import('../lib/google-service-account');
    const refreshed = await fetchServiceAccountAccessToken(tokens.serviceAccount);
    const nextTokens = {
      ...tokens,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    };
    await this.persistTokens(driveAccountId, nextTokens);
    return refreshed.accessToken;
  }

  // ponytail: best-effort revoke on disconnect; Google ignores already-revoked tokens
  async revokeTokens(driveAccountId: string): Promise<void> {
    try {
      const tokens = await this.loadTokens(driveAccountId);
      const token = tokens.refreshToken || tokens.accessToken;
      if (!token) return;
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
    } catch {
      // disconnect still proceeds if revoke fails
    }
  }

  // ponytail: last-write-wins refresh — sync is mostly serial (activeSyncs guard); add single-flight lock if races become a problem
  private async refreshToken(driveAccountId: string, refreshToken: string): Promise<string> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed for ${driveAccountId}: ${error}`);
    }

    const data: { access_token: string; expires_in: number } = await response.json();

    // Update KV with new access token (keep existing refresh token)
    const existing = await this.loadTokens(driveAccountId);
    const nextTokens = {
      ...existing,
      accessToken: data.access_token,
      refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    } satisfies OAuthTokens;
    await this.persistTokens(driveAccountId, nextTokens);

    return data.access_token;
  }

  // ─── Quota ───

  /**
   * Google omits storageQuota.limit for Google Workspace pooled storage and
   * service accounts (returned only "if applicable"). `hasLimit` tells callers
   * whether `total` is a real Google-reported limit or the unlimited fallback,
   * so they avoid overwriting a user-set override / stored value with the 1 TiB
   * ceiling when Google provides no real limit.
   */
  async getQuota(
    driveAccountId: string
  ): Promise<{ total: number; used: number; hasLimit: boolean }> {
    // Check D1 cache first. Cache entries carry the schema version so stale
    // pre-usageInDrive entries (which stored account-wide usage) are ignored.
    const cacheRow = await this.db.prepare('SELECT payload, updated_at FROM quota_cache WHERE drive_account_id = ?')
      .bind(driveAccountId).first<{ payload: string; updated_at: number }>();
    if (cacheRow && Date.now() - cacheRow.updated_at < QUOTA_CACHE_TTL_MS) {
      const quota: QuotaCache = JSON.parse(cacheRow.payload);
      if (quota.v === QUOTA_CACHE_VERSION && quota.total > 0) {
        return { total: quota.total, used: quota.used, hasLimit: quota.hasLimit };
      }
    }

    // Fetch from Google Drive API
    const token = await this.getValidToken(driveAccountId);
    const response = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch quota: ${await response.text()}`);
    }

    const data: {
      storageQuota: { limit?: string; usageInDrive?: string; usage?: string };
    } = await response.json();

    const hasLimit = data.storageQuota.limit != null && data.storageQuota.limit !== '';
    const { total, used } = parseStorageQuota(
      data.storageQuota.limit,
      data.storageQuota.usageInDrive,
      data.storageQuota.usage
    );

    // Cache in D1 (5-min TTL enforced by updated_at check above)
    const payload = JSON.stringify({
        v: QUOTA_CACHE_VERSION,
        total,
        used,
        hasLimit,
        updatedAt: new Date().toISOString(),
      } satisfies QuotaCache);
    await this.db.prepare(
      'INSERT INTO quota_cache (drive_account_id, payload, updated_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(drive_account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at'
    ).bind(driveAccountId, payload, Date.now()).run();

    return { total, used, hasLimit };
  }

  // ─── Folder Operations ───

  async getRootFolderId(driveAccountId: string): Promise<string> {
    const token = await this.getValidToken(driveAccountId);
    const response = await fetch(`${DRIVE_API}/files/root?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Failed to get root folder ID: ${await response.text()}`);
    }
    const data: { id: string } = await response.json();
    return data.id;
  }

  async createFolder(
    driveAccountId: string,
    name: string,
    parentId?: string
  ): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) {
      metadata.parents = [parentId];
    }

    const response = await fetch(`${DRIVE_API}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error(`Failed to create folder: ${await response.text()}`);
    }

    const folder: { id: string } = await response.json();
    return folder.id;
  }

  // ─── Upload ───

  async initiateResumableUpload(
    driveAccountId: string,
    fileName: string,
    mimeType: string,
    parentFolderId: string
  ): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
        },
        body: JSON.stringify({
          name: fileName,
          parents: [parentFolderId],
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to initiate upload: ${await response.text()}`);
    }

    const uploadUrl = response.headers.get('Location');
    if (!uploadUrl) {
      throw new Error('No upload URL in response');
    }

    return uploadUrl;
  }

  // ─── File Operations ───

  async getFile(
    driveAccountId: string,
    googleFileId: string
  ): Promise<GDriveFile> {
    const token = await this.getValidToken(driveAccountId);
    const fields = 'id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum';

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}?fields=${fields}&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get file: ${await response.text()}`);
    }

    return response.json();
  }

  async downloadFile(driveAccountId: string, googleFileId: string, mimeType?: string): Promise<{stream: ReadableStream<Uint8Array>, exportedMimeType?: string, exportedExtension?: string}> {
    const token = await this.getValidToken(driveAccountId);

    let url = `${DRIVE_API}/files/${googleFileId}?alt=media`;
    let exportedMimeType = undefined;
    let exportedExtension = undefined;

    // Handle Google Workspace documents by exporting them
    if (mimeType && mimeType.startsWith('application/vnd.google-apps.')) {
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        exportedMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        exportedExtension = '.xlsx';
      } else if (mimeType === 'application/vnd.google-apps.document') {
        exportedMimeType = 'application/pdf';
        exportedExtension = '.pdf';
      } else if (mimeType === 'application/vnd.google-apps.presentation') {
        exportedMimeType = 'application/pdf';
        exportedExtension = '.pdf';
      } else {
        // Fallback for drawing, script, etc.
        exportedMimeType = 'application/pdf';
        exportedExtension = '.pdf';
      }
      url = `${DRIVE_API}/files/${googleFileId}/export?mimeType=${exportedMimeType}`;
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${await response.text()}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }
    return {
      stream: response.body as ReadableStream<Uint8Array>,
      exportedMimeType,
      exportedExtension
    };
  }

  async deleteFile(driveAccountId: string, googleFileId: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete file: ${await response.text()}`);
    }
  }

  async renameFile(driveAccountId: string, googleFileId: string, newName: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    });

    if (!response.ok) {
      throw new Error(`Failed to rename file: ${await response.text()}`);
    }
  }

  // ─── Move To Another Drive Operations ───

  async shareFile(driveAccountId: string, fileId: string, emailAddress: string, role = 'writer', type = 'user'): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${fileId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role, type, emailAddress }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try { errorData = JSON.parse(errorText); } catch {}
      throw new GoogleDriveError(response.status, `Failed to share file: ${errorText}`, errorData);
    }

    const data: { id: string } = await response.json();
    return data.id;
  }

  async revokeShare(driveAccountId: string, fileId: string, permissionId: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${fileId}/permissions/${permissionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try { errorData = JSON.parse(errorText); } catch {}
      throw new GoogleDriveError(response.status, `Failed to revoke share: ${errorText}`, errorData);
    }
  }

  async copyFile(driveAccountId: string, fileId: string): Promise<GDriveFile> {
    const token = await this.getValidToken(driveAccountId);
    const fields = 'id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum';

    const response = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=${fields}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try { errorData = JSON.parse(errorText); } catch {}
      throw new GoogleDriveError(response.status, `Failed to copy file: ${errorText}`, errorData);
    }

    return response.json();
  }

  async trashFile(driveAccountId: string, fileId: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try { errorData = JSON.parse(errorText); } catch {}
      throw new GoogleDriveError(response.status, `Failed to trash file: ${errorText}`, errorData);
    }
  }

  async untrashFile(driveAccountId: string, fileId: string): Promise<void> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: false }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try { errorData = JSON.parse(errorText); } catch {}
      throw new GoogleDriveError(response.status, `Failed to untrash file: ${errorText}`, errorData);
    }
  }

  // ─── Changes API (for sync) ───

  async getStartPageToken(driveAccountId: string): Promise<string> {
    const token = await this.getValidToken(driveAccountId);

    const response = await fetch(`${DRIVE_API}/changes/startPageToken`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get start page token: ${await response.text()}`);
    }

    const data: { startPageToken: string } = await response.json();
    return data.startPageToken;
  }

  async listChanges(
    driveAccountId: string,
    pageToken: string
  ): Promise<{
    changes: Array<{
      fileId: string;
      removed: boolean;
      file?: {
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        parents?: string[];
        owners?: GDriveOwner[];
        trashed: boolean;
        thumbnailLink?: string;
        webViewLink?: string;
        webContentLink?: string;
        createdTime: string;
        modifiedTime: string;
      };
    }>;
    nextPageToken?: string;
    newStartPageToken?: string;
  }> {
    const token = await this.getValidToken(driveAccountId);
    const fields =
      'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,parents,owners(me,displayName),trashed,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum))';

    const response = await fetch(
      `${DRIVE_API}/changes?pageToken=${encodeURIComponent(pageToken)}&fields=${fields}&spaces=drive&includeRemoved=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`Failed to list changes: ${await response.text()}`);
    }

    return response.json();
  }

  async listFilesInFolder(
    driveAccountId: string,
    folderId: string
  ): Promise<
    Array<{
      id: string;
      name: string;
      mimeType: string;
      size?: string;
      thumbnailLink?: string;
      webViewLink?: string;
      webContentLink?: string;
      createdTime: string;
      modifiedTime: string;
    }>
  > {
    const fields = 'files(id,name,mimeType,size,owners(me,displayName),thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum)';
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);

    const allFiles: Array<GDriveFile> = [];
    let pageToken: string | undefined;

    do {
      const token = await this.getValidToken(driveAccountId);
      const url = `${DRIVE_API}/files?q=${q}&fields=nextPageToken,${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${await response.text()}`);
      }

      const data: { files: GDriveFile[]; nextPageToken?: string } = await response.json();
      allFiles.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }

  // ─── Full Folder Contents (files + subfolders) ───

  async listFolderContents(
    driveAccountId: string,
    folderId: string
  ): Promise<{ files: GDriveFile[]; folders: GDriveFolder[] }> {
    const fields =
      'nextPageToken,files(id,name,mimeType,size,parents,owners(me,displayName),trashed,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum)';
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);

    const allFiles: GDriveFile[] = [];
    const allFolders: GDriveFolder[] = [];
    let pageToken: string | undefined;

    do {
      const token = await this.getValidToken(driveAccountId);
      const url = `${DRIVE_API}/files?q=${q}&fields=${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to list folder contents: ${await response.text()}`);
      }

      const data: { files: GDriveFile[]; nextPageToken?: string } = await response.json();
      
      for (const file of data.files) {
        if (file.mimeType === 'application/vnd.google-apps.shortcut') continue;
        if (file.mimeType === 'application/vnd.google-apps.folder') {
          allFolders.push(file);
        } else {
          allFiles.push(file);
        }
      }
      
      pageToken = data.nextPageToken;
    } while (pageToken);

    return { files: allFiles, folders: allFolders };
  }

  async *iterateAllFilesAndFolders(
    driveAccountId: string,
    startPageToken?: string
  ): AsyncGenerator<{ files: GDriveFile[]; folders: GDriveFolder[]; nextPageToken?: string }, void, unknown> {
    const fields =
      'nextPageToken,files(id,name,mimeType,size,parents,owners(me,displayName),trashed,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime,md5Checksum)';
    const q = encodeURIComponent(`trashed = false`);

    let pageToken: string | undefined = startPageToken;

    do {
      const token = await this.getValidToken(driveAccountId);
      const url = `${DRIVE_API}/files?q=${q}&fields=${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to list folder contents: ${await response.text()}`);
      }

      const data: { files: GDriveFile[]; nextPageToken?: string } = await response.json();

      const chunkFiles: GDriveFile[] = [];
      const chunkFolders: GDriveFolder[] = [];

      for (const item of data.files) {
        if (item.mimeType === 'application/vnd.google-apps.folder') {
          chunkFolders.push({ id: item.id, name: item.name, parents: item.parents, owners: item.owners });
        } else if (item.mimeType !== 'application/vnd.google-apps.shortcut') {
          chunkFiles.push(item);
        }
      }

      yield { files: chunkFiles, folders: chunkFolders, nextPageToken: data.nextPageToken };
      
      pageToken = data.nextPageToken;
    } while (pageToken);
  }
}
