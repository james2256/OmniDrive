import { request, API_BASE, ApiError, uploadChunkWithRetry } from './core';
import type {
  FileEntry,
  UploadInitResponse,
  DriveFolder,
  WorkspaceFolder,
  BreadcrumbItem,
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
  initiateUpload: (
    data: {
      name: string;
      mimeType: string;
      size: number;
      driveAccountId?: string;
      parentFolderId?: string;
    },
    signal?: AbortSignal,
  ) =>
    request<UploadInitResponse>('/api/files/upload/init', {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),
  confirmUpload: (
    data: {
      googleFileId: string;
      driveAccountId: string;
      parentFolderId?: string;
    },
    signal?: AbortSignal,
  ) =>
    request<{ file: FileEntry }>('/api/files/upload/finalize', {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),
  /**
   * Ensure a nested folder path exists on a drive (creating as needed).
   * Returns the leaf folder's Google ID for use as `parentFolderId` in
   * subsequent `initiateUpload` calls. Used by folder upload.
   */
  ensureFolder: (driveId: string, path: string, parentFolderId?: string) =>
    request<{ googleFolderId: string }>(`/api/drives/${driveId}/folders/ensure`, {
      method: 'POST',
      body: JSON.stringify({ path, parentFolderId }),
    }),
  /**
   * Batch-ensure multiple folder paths in a single request. Used by folder
   * upload to avoid N+1 HTTP round-trips. Returns a map of path → googleFolderId.
   * Server caps at 15 folder creations per call (D1 + external subrequest budget).
   */
  ensureFoldersBatch: (driveId: string, paths: string[], parentFolderId?: string) =>
    request<{ folderIds: Record<string, string> }>(`/api/drives/${driveId}/folders/ensure-batch`, {
      method: 'POST',
      body: JSON.stringify({ paths, parentFolderId }),
    }),
  uploadViaProxy: async (
    uploadUrl: string,
    file: File,
    onProgress?: (percent: number) => void,
    signal?: AbortSignal,
  ): Promise<{ id: string }> => {
    let startByte = 0;
    while (true) {
      // uploadChunkWithRetry handles transient 429/5xx/network errors with
      // exponential backoff (mirrors worker's withBackoff pattern).
      const result = await uploadChunkWithRetry(uploadUrl, file, startByte, onProgress, 2, signal);
      if (result.done) return result.value;
      startByte = result.nextStart;
    }
  },
  moveFile: (id: string, workspaceFolderId?: string | null) =>
    request<void>(`/api/files/${id}/move`, {
      method: 'PATCH',
      body: JSON.stringify({ workspaceFolderId }),
    }),
  renameFile: (id: string, name: string) =>
    request<void>(`/api/files/${id}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteFile: (id: string) => request<void>(`/api/files/${id}`, { method: 'DELETE' }),
  moveFileToDrive: (id: string, targetDriveId: string) =>
    request<{ file: FileEntry }>(`/api/files/${id}/move-drive`, {
      method: 'POST',
      body: JSON.stringify({ targetDriveId }),
    }),
  getTrashFiles: () =>
    request<{
      folder: DriveFolder | null;
      subfolders: DriveFolder[];
      files: FileEntry[];
      breadcrumb: BreadcrumbItem[];
    }>('/api/files/trash'),
  restoreFile: (id: string) => request<void>(`/api/files/${id}/restore`, { method: 'POST' }),
  deleteFilePermanent: (id: string) =>
    request<void>(`/api/files/${id}/permanent`, { method: 'DELETE' }),
  getStarred: () =>
    request<{
      folder: null;
      subfolders: (WorkspaceFolder | DriveFolder)[];
      files: FileEntry[];
      breadcrumb: BreadcrumbItem[];
    }>('/api/files/starred'),
  starFile: (id: string) => request<void>(`/api/files/${id}/star`, { method: 'POST' }),
  unstarFile: (id: string) => request<void>(`/api/files/${id}/unstar`, { method: 'POST' }),
  getRecentFiles: () =>
    request<{
      folder: null;
      subfolders: WorkspaceFolder[];
      files: FileEntry[];
      breadcrumb: BreadcrumbItem[];
    }>('/api/files/recent'),
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
    request<void>(`/api/files/${fileId}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ metadata }),
    }),
  updateFolderMetadata: (workspaceId: string, folderId: string, metadata: Record<string, string>) =>
    request<void>(`/api/workspaces/${workspaceId}/folders/${folderId}/metadata`, {
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
