import type { Env, OAuthTokens } from '../types/env';
import { AppError } from '../middleware/error-handler';

export class DriveService {
  constructor(
    protected env: Env,
    protected driveAccountId: string,
    private tokens: OAuthTokens
  ) {}

  private async fetchWithAuth(url: string, init?: RequestInit): Promise<Response> {
    // In a real app, we'd check if accessToken is expired and use refreshToken here
    // For this implementation, we assume the token is valid or prompt re-login
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${this.tokens.accessToken}`);

    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      if (res.status === 401) {
        throw new AppError(401, 'Google Drive token expired');
      }
      throw new AppError(res.status, `Google Drive API error: ${await res.text()}`);
    }
    return res;
  }

  async getQuota(): Promise<{ total: number; used: number }> {
    const res = await this.fetchWithAuth('https://www.googleapis.com/drive/v3/about?fields=storageQuota');
    const data = await res.json() as any;
    return {
      total: parseInt(data.storageQuota.limit || '0', 10),
      used: parseInt(data.storageQuota.usage || '0', 10),
    };
  }

  async createResumableUploadSession(metadata: { name: string; mimeType: string; parents?: string[] }): Promise<string> {
    const res = await this.fetchWithAuth('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    const locationUrl = res.headers.get('Location');
    if (!locationUrl) {
      throw new AppError(500, 'Failed to get resumable upload session URL from Google');
    }
    return locationUrl;
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
    });
  }
}
