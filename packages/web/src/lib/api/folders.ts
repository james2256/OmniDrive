import { request } from './core';
import type { WorkspaceFolder, FolderContents } from '../../types';

export const foldersApi = {
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
  updateFolder: (
    id: string,
    data: { name?: string; parentId?: string | null; icon?: string; color?: string },
  ) =>
    request<{ success: boolean }>(`/api/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteFolder: (id: string) =>
    request<{ success: boolean }>(`/api/folders/${id}`, { method: 'DELETE' }),
  getWorkspaceTree: () => request<{ folders: WorkspaceFolder[] }>('/api/folders/tree'),
  addFilesToWorkspace: (id: string, fileIds: string[]) =>
    request<{ success: boolean }>(`/api/folders/${id}/files`, {
      method: 'POST',
      body: JSON.stringify({ fileIds }),
    }),
  syncWorkspace: (id: string) =>
    request<{ success: boolean }>(`/api/folders/${id}/sync`, { method: 'POST' }),
  forceSyncFolder: (id: string, driveId: string) =>
    request<{ success: boolean }>(`/api/folders/${id}/force-sync?driveId=${driveId}`, {
      method: 'POST',
    }),
  starFolder: (id: string) =>
    request<{ success: boolean }>(`/api/folders/${id}/star`, { method: 'POST' }),
  unstarFolder: (id: string) =>
    request<{ success: boolean }>(`/api/folders/${id}/unstar`, { method: 'POST' }),
};
