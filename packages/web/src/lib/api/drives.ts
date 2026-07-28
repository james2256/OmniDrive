import { request } from './core';
import type {
  DriveAccount,
  AggregateQuota,
  DriveFolderContents,
  DriveFolder,
  FileEntry,
  BreadcrumbItem,
} from '../../types';

export const drivesApi = {
  getDrives: () => request<{ drives: DriveAccount[]; aggregate: AggregateQuota }>('/api/drives/'),
  disconnectDrive: (id: string) =>
    request<{ success: boolean }>(`/api/drives/${id}`, { method: 'DELETE' }),
  addServiceAccount: (credentials: string, folderId: string) =>
    request<{ success: boolean; driveId: string }>('/api/drives/service-account', {
      method: 'POST',
      body: JSON.stringify({ credentials, folderId }),
    }),
  triggerSync: (id: string) =>
    request<{ success: boolean }>(`/api/drives/${id}/sync`, { method: 'POST' }),
  getDriveFolderContents: (driveId: string, googleFolderId: string) =>
    request<DriveFolderContents>(`/api/drives/${driveId}/folders/${googleFolderId}`),
  deleteDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}`, {
      method: 'DELETE',
    }),
  restoreDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/restore`, {
      method: 'POST',
    }),
  deleteDriveFolderPermanent: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/permanent`, {
      method: 'DELETE',
    }),
  starDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/star`, {
      method: 'POST',
    }),
  unstarDriveFolder: (driveId: string, googleFolderId: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/unstar`, {
      method: 'POST',
    }),
  createDriveFolder: (driveId: string, name: string, parentGoogleFolderId?: string) =>
    request<{ success: boolean; googleFolderId: string }>(`/api/drives/${driveId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ name, parentId: parentGoogleFolderId }),
    }),
  renameDriveFolder: (driveId: string, googleFolderId: string, name: string) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/folders/${googleFolderId}/rename`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  moveToFolder: (
    driveId: string,
    googleFileId: string,
    targetFolderId: string,
    oldParentId: string | null,
    isFolder: boolean,
  ) =>
    request<{ success: boolean }>(`/api/drives/${driveId}/move/${googleFileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ targetFolderId, oldParentId, isFolder }),
    }),
  getExternal: (cursor?: string) =>
    request<{
      files: FileEntry[];
      folders: DriveFolder[];
      hasMore: boolean;
      nextCursor: string | null;
    }>(`/api/drives/external${cursor ? `?cursor=${cursor}` : ''}`),
  getExternalFolderContents: (driveId: string, folderId: string) =>
    request<{
      folder: DriveFolder | null;
      subfolders: DriveFolder[];
      files: FileEntry[];
      breadcrumb: BreadcrumbItem[];
    }>(`/api/drives/${driveId}/external-folders/${folderId}`),
};
