import { request, API_BASE, ApiError, uploadChunk } from './core';
import type {
  FileEntry,
  UploadInitResponse,
  DriveFolder,
  WorkspaceFolder,
  SearchResults,
} from '../../types';

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

export const filesApi = {
  searchFiles: (query: string) =>
    request<SearchResults>(`/api/files/search?q=${encodeURIComponent(query)}`),
  initiateUpload: (data: {
    name: string;
    mimeType: string;
    size: number;
    driveAccountId?: string;
    parentFolderId?: string;
  }) =>
    request<UploadInitResponse>('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  confirmUpload: (data: {
    googleFileId: string;
    driveAccountId: string;
    parentFolderId?: string;
  }) =>
    request<{ file: FileEntry }>('/api/files/upload/finalize', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  uploadViaProxy: async (
    uploadUrl: string,
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<{ id: string }> => {
    let startByte = 0;
    while (true) {
      const result = await uploadChunk(uploadUrl, file, startByte, onProgress);
      if (result.done) return result.value;
      startByte = result.nextStart;
    }
  },
  moveFile: (id: string, workspaceFolderId?: string | null) =>
    request<{ success: boolean }>(`/api/files/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceFolderId }),
    }),
  renameFile: (id: string, name: string) =>
    request<{ success: boolean }>(`/api/files/${id}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}`, { method: 'DELETE' }),
  moveFileToDrive: (id: string, targetDriveId: string) =>
    request<{ file: FileEntry }>(`/api/files/${id}/move-drive`, {
      method: 'POST',
      body: JSON.stringify({ targetDriveId }),
    }),
  getTrashFiles: () => request<{ files: FileEntry[]; folders: DriveFolder[] }>('/api/files/trash'),
  restoreFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/restore`, { method: 'POST' }),
  deleteFilePermanent: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/permanent`, { method: 'DELETE' }),
  getStarred: () =>
    request<{ files: FileEntry[]; folders: WorkspaceFolder[]; driveFolders: DriveFolder[] }>(
      '/api/files/starred',
    ),
  starFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/star`, { method: 'POST' }),
  unstarFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/unstar`, { method: 'POST' }),
  getRecentFiles: () =>
    request<{ files: FileEntry[]; folders: WorkspaceFolder[] }>('/api/files/recent'),
  getFileCategoryOverview: () =>
    request<{
      images: number;
      videos: number;
      documents: number;
      audio: number;
      archives: number;
      others: number;
    }>('/api/files/category-overview'),
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
  globalSearch: (
    query: string,
    workspaceId?: string,
    metadata?: Record<string, string>,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (workspaceId) params.set('workspaceId', workspaceId);
    if (metadata && Object.keys(metadata).length > 0) {
      params.set('metadata', JSON.stringify(metadata));
    }
    return request<SearchResults>(`/api/files/search?${params.toString()}`, { signal });
  },
};
