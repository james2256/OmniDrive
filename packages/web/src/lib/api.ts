const API_BASE = import.meta.env.VITE_API_URL ?? '';
import type { User, DriveAccount, AutomationRule, AggregateQuota, DriveFolderContents, FolderContents, FileEntry, UploadInitResponse, WorkspaceFolder, AuditLog, WorkspacePolicy, DriveFolder, BreadcrumbItem } from '../types';

interface RegisterPayload extends LoginPayload { name?: string; email?: string; invitation_code?: string; }
export interface Invitation { id: string; code: string; max_uses: number; used_count: number; expires_at: string | null; created_at: string; }
interface AdminCreateUserPayload { username: string; password: string; name?: string; email?: string; role?: string; }
export interface S3Credential { id: string; description: string | null; access_key_id: string; accessKeyId: string; workspace_id: string | null; workspaceId: string | null; workspace_name?: string | null; workspaceName?: string | null; created_at: string; createdAt: string; }
interface LoginPayload { username: string; password: string; }

export function getFilePreviewUrl(fileId: string): string {
  return `${API_BASE}/api/files/${fileId}/preview`;
}

export async function fetchFilePreviewBlob(fileId: string): Promise<Blob> {
  const response = await fetch(getFilePreviewUrl(fileId), { credentials: 'include' });
  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to load preview');
  }
  return response.blob();
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  getSetupStatus: () => request<{ isSetup: boolean }>('/api/auth/setup-status'),
  login: (data: LoginPayload) => request<{ success: boolean; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  register: (data: RegisterPayload) => request<{ success: boolean; user: User }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  getUser: () => request<{ user: User }>('/api/auth/me'),
  // OAuth initiation: backend returns the Google auth URL as JSON (the SPA
  // performs the redirect). Called via credentialed fetch so the session
  // cookie is sent; the backend stores userId in the KV OAuth state.
  getGoogleOAuthUrl: () => request<{ url: string }>('/api/auth/google'),
  getDriveConnectUrl: () => request<{ url: string }>('/api/drives/connect'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  getInvitations: () => request<{ invitations: Invitation[] }>('/api/admin/invitations'),
  createInvitation: (code: string, max_uses: number) => request<{ success: boolean, invitation: Invitation }>('/api/admin/invitations', { method: 'POST', body: JSON.stringify({ code, max_uses }) }),
  deleteInvitation: (id: string) => request<{ success: boolean }>(`/api/admin/invitations/${id}`, { method: 'DELETE' }),
  getAdminUsers: () => request<{ users: User[] }>('/api/admin/users'),
  adminCreateUser: (data: AdminCreateUserPayload) => request<{ success: boolean; user: User }>('/api/admin/users', { method: 'POST', body: JSON.stringify(data) }),

  // Drives
  getDrives: () =>
    request<{ drives: DriveAccount[]; aggregate: AggregateQuota }>('/api/drives/'),
  disconnectDrive: (id: string) => request<{ success: boolean }>(`/api/drives/${id}`, { method: 'DELETE' }),
  addServiceAccount: (credentials: string, folderId: string) =>
    request<{ success: boolean; driveId: string }>('/api/drives/service-account', {
      method: 'POST',
      body: JSON.stringify({ credentials, folderId }),
    }),
  triggerSync: (id: string) => request<{ success: boolean }>(`/api/drives/${id}/sync`, { method: 'POST' }),
  getDriveFolderContents: (driveId: string, googleFolderId: string) =>
    request<DriveFolderContents>(`/api/drives/${driveId}/folders/${googleFolderId}`),

  // Folders
  getFolderContents: (id: string, cursor?: string, limit?: number, driveId?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', limit.toString());
    if (driveId) params.set('driveId', driveId);
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<FolderContents>(`/api/folders/${id}${query}`);
  },
  createFolder: (name: string, parentId?: string, icon?: string, color?: string) =>
    request<{ folder: WorkspaceFolder }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId, icon, color }),
    }),
  updateFolder: (id: string, data: { name?: string; parentId?: string | null; icon?: string; color?: string }) =>
    request<{ success: boolean }>(`/api/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteFolder: (id: string) => request<{ success: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),
  deleteDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}`, { method: 'DELETE' }),

  getWorkspaceTree: () => request<{ folders: WorkspaceFolder[] }>('/api/folders/tree'),
  addFilesToWorkspace: (id: string, fileIds: string[]) =>
    request<{ success: boolean }>(`/api/folders/${id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileIds }),
    }),
  syncWorkspace: (id: string) =>
    request<{ success: boolean }>(`/api/folders/${id}/sync`, { method: 'POST' }),
  forceSyncFolder: (id: string, driveId: string) => 
    request<{ success: boolean }>(`/api/folders/${id}/force-sync?driveId=${driveId}`, { method: 'POST' }),

  // Files
  getFile: (id: string) => request<FileEntry>(`/api/files/${id}`),
  searchFiles: (query: string) =>
    request<{ files: FileEntry[]; query: string }>(`/api/files/search?q=${encodeURIComponent(query)}`),
  initiateUpload: (data: { name: string; mimeType: string; size: number; driveAccountId?: string; parentFolderId?: string }) =>
    request<UploadInitResponse>('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  confirmUpload: (data: { googleFileId: string; driveAccountId: string; parentFolderId?: string }) =>
    request<{ file: FileEntry }>('/api/files/upload/finalize', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Upload file bytes via Worker proxy (bypasses Google CORS restriction)
  uploadViaProxy: (uploadUrl: string, file: File, onProgress?: (percent: number) => void) => {
    return new Promise<{ id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result = JSON.parse(xhr.responseText);
            if (!result.id) {
              reject(new Error(`Upload response missing file ID`));
            } else {
              resolve(result);
            }
          } catch {
            reject(new Error(`Upload response not valid JSON: ${xhr.responseText.substring(0, 100)}`));
          }
        } else if (xhr.status === 308) {
          // Google resumable upload incomplete - need to resume
          reject(new Error(`Upload incomplete, Google returned 308 Resume Incomplete`));
        } else {
          reject(new Error(`Upload proxy failed: ${xhr.status} - ${xhr.responseText.substring(0, 100)}`));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.open('PUT', `${API_BASE}/api/files/upload/proxy`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Upload-Url', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      // Google resumable single-chunk upload requires Content-Range header
      xhr.setRequestHeader('Content-Range', `bytes 0-${file.size - 1}/${file.size}`);
      xhr.send(file);
    });
  },
  moveFile: (id: string, workspaceFolderId: string | null) =>
    request<{ success: boolean }>(`/api/files/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceFolderId }),
    }),
  renameFile: (id: string, name: string) =>
    request<{ success: boolean }>(`/api/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (id: string) => request<{ success: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),
  moveFileToDrive: (id: string, targetDriveId: string) =>
    request<{ file: FileEntry }>(`/api/files/${id}/move-drive`, {
      method: 'POST',
      body: JSON.stringify({ targetDriveId }),
    }),

  // Trash
  getTrashFiles: () =>
    request<{ files: FileEntry[]; folders: DriveFolder[] }>('/api/files/trash'),
  restoreFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/restore`, { method: 'POST' }),
  deleteFilePermanent: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/permanent`, { method: 'DELETE' }),
  restoreDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/restore`, { method: 'POST' }),
  deleteDriveFolderPermanent: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/permanent`, { method: 'DELETE' }),
  starDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/star`, { method: 'POST' }),
  unstarDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/unstar`, { method: 'POST' }),
  renameDriveFolder: (driveId: string, googleFolderId: string, name: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  moveToFolder: (driveId: string, googleFileId: string, targetFolderId: string, oldParentId: string | null, isFolder: boolean) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/move/${googleFileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetFolderId, oldParentId, isFolder }),
    }),
  getSharedWithMe: () =>
    request<{ files: FileEntry[]; folders: DriveFolder[] }>('/api/drives/shared-with-me'),
  getSharedFolderContents: (driveId: string, folderId: string) =>
    request<{ folder: DriveFolder | null; subfolders: DriveFolder[]; files: FileEntry[]; breadcrumb: BreadcrumbItem[] }>(`/api/drives/${driveId}/shared-folders/${folderId}`),

  // Starred Files
  getStarred: () => request<{ files: FileEntry[], folders: WorkspaceFolder[] }>('/api/files/starred'),
  starFile: (id: string) => request<{ success: boolean }>(`/api/files/${id}/star`, { method: 'POST' }),
  unstarFile: (id: string) => request<{ success: boolean }>(`/api/files/${id}/unstar`, { method: 'POST' }),
  starFolder: (id: string) => request<{ success: boolean }>(`/api/folders/${id}/star`, { method: 'POST' }),
  unstarFolder: (id: string) => request<{ success: boolean }>(`/api/folders/${id}/unstar`, { method: 'POST' }),

  // Recent files (sorted by Google modified date)
  getRecentFiles: () =>
    request<{ files: FileEntry[], folders: WorkspaceFolder[] }>('/api/files/recent'),
    
  // Category overview
  getFileCategoryOverview: () =>
    request<{ images: number; videos: number; documents: number; audio: number; archives: number; others: number }>('/api/files/category-overview'),

  // Automations
  getAutomations: () => request<{ rules: AutomationRule[] }>('/api/automations'),
  toggleAutomation: (id: string, is_active: boolean) =>
    request<{ success: boolean }>(`/api/automations/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),

  // Audit Logs
  getWorkspaceAuditLogs: (workspaceId: string) =>
    request<{ logs: AuditLog[] }>(`/api/workspaces/${workspaceId}/audit-logs`),

  // Policies
  getWorkspacePolicies: (workspaceId: string) =>
    request<{ policies: WorkspacePolicy[] }>(`/api/workspaces/${workspaceId}/policies`),
  createWorkspacePolicy: (workspaceId: string, data: { targetType: 'workspace' | 'folder', targetId?: string, policyType: 'storage_quota' | 'data_retention', config: Record<string, unknown> }) =>
    request<{ policy: WorkspacePolicy }>(`/api/workspaces/${workspaceId}/policies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteWorkspacePolicy: (workspaceId: string, policyId: string) =>
    request<{ success: boolean }>(`/api/workspaces/${workspaceId}/policies/${policyId}`, { method: 'DELETE' }),

  // Metadata & Search
  updateFileMetadata: (fileId: string, metadata: Record<string, string>) =>
    request<{ success: boolean }>(`/api/files/${fileId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata }),
    }),
  updateFolderMetadata: (workspaceId: string, folderId: string, metadata: Record<string, string>) =>
    request<{ success: boolean }>(`/api/workspaces/${workspaceId}/folders/${folderId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata }),
    }),
  globalSearch: (query: string, workspaceId?: string, metadata?: Record<string, string>) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (metadata && Object.keys(metadata).length > 0) params.set('metadata', JSON.stringify(metadata));
    return request<{ files: FileEntry[], query: string }>(`/api/files/search?${params.toString()}`);
  },

  // Workspaces & S3 Credentials
  getWorkspaces: () => request<{ workspaces: { id: string; name: string; role: string }[] }>('/api/workspaces'),
  getS3Credentials: () => request<S3Credential[]>('/api/s3-credentials'),
  createS3Credential: (description: string, workspaceId?: string) =>
    request<{ id: string; accessKeyId: string; secretAccessKey: string; description: string; createdAt: string }>('/api/s3-credentials', {
      method: 'POST',
      body: JSON.stringify({ description, workspaceId }),
    }),
  deleteS3Credential: (id: string) => request<{ success: boolean }>(`/api/s3-credentials/${id}`, { method: 'DELETE' }),
};

export { ApiError };

export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  targetName?: string;
  expiresAt: string | null;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
  allowDownloads: boolean;
  allowUploads: boolean;
  maxDownloads: number | null;
  requireEmail: boolean;
  webhookUrl: string | null;
}

export interface SharedMetaResponse {
  type?: 'file' | 'folder';
  target?: FileEntry;
  targetId?: string;
  requiresPassword?: boolean;
}

export interface CreateSharedLinkPayload {
  targetType: 'file' | 'folder';
  targetId: string;
  password?: string | null;
  expiresAt?: string | null;
  allowDownloads?: boolean;
  allowUploads?: boolean;
  maxDownloads?: number | null;
  requireEmail?: boolean;
  webhookUrl?: string;
}

export const createSharedLink = async (payload: CreateSharedLinkPayload) => {
  return request<{ id: string; url: string }>('/api/shared', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export async function updateSharedLink(id: string, payload: Partial<CreateSharedLinkPayload>) {
  return await request(`/api/shared/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export const getSharedLinks = async () => {
  return request<{ links: SharedLink[] }>('/api/shared');
};

export const deleteSharedLink = async (id: string) => {
  return request<{ success: boolean }>(`/api/shared/${id}`, { method: 'DELETE' });
};

export const getSharedMeta = async (id: string) => {
  try {
    return await request<SharedMetaResponse>(`/api/shared/${id}/meta`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { requiresPassword: true };
    }
    throw error;
  }
};

export const verifySharedPassword = async (id: string, password: string) => {
  return request<{ success: boolean }>(`/api/shared/${id}/verify`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }).catch((error) => {
    if (error instanceof ApiError && error.status === 401) {
      throw new Error('Invalid password');
    }
    throw error;
  });
};
