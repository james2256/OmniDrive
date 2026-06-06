import type { OAuthTokens, QuotaCache } from '../types/index';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleDriveService {
  constructor(
    private kv: KVNamespace,
    private clientId: string,
    private clientSecret: string
  ) {}

  // ─── Token Management ───

  async getValidToken(driveAccountId: string): Promise<string> {
    const tokensJson = await this.kv.get(`oauth:${driveAccountId}`);
    if (!tokensJson) {
      throw new Error(`No tokens found for drive ${driveAccountId}`);
    }

    const tokens: OAuthTokens = JSON.parse(tokensJson);

    // Return cached token if not expired (with 60s buffer)
    if (tokens.expiresAt > Date.now() + 60_000) {
      return tokens.accessToken;
    }

    // Refresh the token
    return this.refreshToken(driveAccountId, tokens.refreshToken);
  }

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
    await this.kv.put(
      `oauth:${driveAccountId}`,
      JSON.stringify({
        accessToken: data.access_token,
        refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
      } satisfies OAuthTokens)
    );

    return data.access_token;
  }

  // ─── Quota ───

  async getQuota(
    driveAccountId: string
  ): Promise<{ total: number; used: number }> {
    // Check KV cache first
    const cached = await this.kv.get(`quota:${driveAccountId}`);
    if (cached) {
      const quota: QuotaCache = JSON.parse(cached);
      return { total: quota.total, used: quota.used };
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
      storageQuota: { limit?: string; usage?: string };
    } = await response.json();

    const total = parseInt(data.storageQuota.limit ?? '0', 10);
    const used = parseInt(data.storageQuota.usage ?? '0', 10);

    // Cache in KV (5-min TTL)
    await this.kv.put(
      `quota:${driveAccountId}`,
      JSON.stringify({ total, used, updatedAt: new Date().toISOString() } satisfies QuotaCache),
      { expirationTtl: 300 }
    );

    return { total, used };
  }

  // ─── Folder Operations ───

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
      `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable`,
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
  ): Promise<{
    id: string;
    name: string;
    mimeType: string;
    size: string;
    thumbnailLink?: string;
    webViewLink?: string;
    webContentLink?: string;
    createdTime: string;
    modifiedTime: string;
  }> {
    const token = await this.getValidToken(driveAccountId);
    const fields = 'id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime';

    const response = await fetch(`${DRIVE_API}/files/${googleFileId}?fields=${fields}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get file: ${await response.text()}`);
    }

    return response.json();
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
      'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,size,parents,trashed,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime))';

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
    const token = await this.getValidToken(driveAccountId);
    const fields = 'files(id,name,mimeType,size,thumbnailLink,webViewLink,webContentLink,createdTime,modifiedTime)';
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);

    const allFiles: Array<any> = [];
    let pageToken: string | undefined;

    do {
      const url = `${DRIVE_API}/files?q=${q}&fields=nextPageToken,${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error(`Failed to list files: ${await response.text()}`);
      }

      const data: { files: any[]; nextPageToken?: string } = await response.json();
      allFiles.push(...data.files);
      pageToken = data.nextPageToken;
    } while (pageToken);

    return allFiles;
  }
}
