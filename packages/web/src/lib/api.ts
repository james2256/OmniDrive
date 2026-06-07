const API_BASE = import.meta.env.VITE_API_URL ?? '';

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
  getUser: () => request<{ user: import('../types').User }>('/api/auth/me'),
  logout: () => request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Drives
  getDrives: () =>
    request<{ drives: import('../types').DriveAccount[]; aggregate: import('../types').AggregateQuota }>('/api/drives/'),
  disconnectDrive: (id: string) => request<{ success: boolean }>(`/api/drives/${id}`, { method: 'DELETE' }),
  addServiceAccount: (credentials: string, folderId: string) =>
    request<{ success: boolean; driveId: string }>('/api/drives/service-account', {
      method: 'POST',
      body: JSON.stringify({ credentials, folderId }),
    }),
  triggerSync: (id: string) => request<{ success: boolean }>(`/api/drives/${id}/sync`, { method: 'POST' }),
  getDriveFolderContents: (driveId: string, googleFolderId: string) =>
    request<import('../types').DriveFolderContents>(`/api/drives/${driveId}/folders/${googleFolderId}`),
  syncDriveFolder: (driveId: string, googleFolderId: string) =>
    request<import('../types').DriveFolderContents>(`/api/drives/${driveId}/folders/${googleFolderId}/sync`, { method: 'POST' }),


  // Folders
  getRootContents: () => request<import('../types').FolderContents>('/api/folders/'),
  getFolderContents: (id: string) => request<import('../types').FolderContents>(`/api/folders/${id}`),
  createFolder: (name: string, parentId?: string, icon?: string, color?: string) =>
    request<{ folder: import('../types').VirtualFolder }>('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId, icon, color }),
    }),
  updateFolder: (id: string, data: { name?: string; parentId?: string }) =>
    request<{ folder: import('../types').VirtualFolder }>(`/api/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteFolder: (id: string) => request<{ success: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),

  // Files
  searchFiles: (query: string) =>
    request<{ files: import('../types').FileEntry[]; query: string }>(`/api/files/search?q=${encodeURIComponent(query)}`),
  initiateUpload: (data: { name: string; mimeType: string; size: number; driveAccountId?: string; virtualFolderId?: string }) =>
    request<import('../types').UploadInitResponse>('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  confirmUpload: (data: { googleFileId: string; driveAccountId: string; virtualFolderId?: string }) =>
    request<{ file: import('../types').FileEntry }>('/api/files/upload/finalize', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  moveFile: (id: string, virtualFolderId: string | null) =>
    request<{ success: boolean }>(`/api/files/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ virtualFolderId }),
    }),
  renameFile: (id: string, name: string) =>
    request<{ success: boolean }>(`/api/files/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (id: string) => request<{ success: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),

  // Recent files (uses root contents, sorted by date)
  getRecentFiles: () =>
    request<{ files: import('../types').FileEntry[] }>('/api/files/search?q=%'),

  // Automations
  getAutomations: () => request<{ rules: any[] }>('/api/automations'),
  toggleAutomation: (id: string, is_active: boolean) =>
    request<{ success: boolean }>(`/api/automations/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active }),
    }),
};

export { ApiError };

export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface SharedMetaResponse {
  type?: 'file' | 'folder';
  target?: import('../types').FileEntry;
  targetId?: string;
  requiresPassword?: boolean;
}

export interface CreateSharedLinkPayload {
  targetType: 'file' | 'folder';
  targetId: string;
  password?: string;
  expiresAt?: string;
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
