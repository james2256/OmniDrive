export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DriveAccount {
  id: string;
  userId: string;
  googleAccountId: string;
  email: string;
  name: string | null;
  type: 'oauth' | 'service_account';
  isPrimary: boolean;
  rootFolderId: string | null;
  totalQuota: number;
  usedQuota: number;
  freeSpace: number;
  usagePercent: number;
  quotaUpdatedAt: string | null;
  createdAt: string;
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface VirtualFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  isStarred?: boolean;
}

export interface FileEntry {
  id: string;
  userId: string;
  driveAccountId: string;
  googleFileId: string;
  virtualFolderId: string | null;
  googleParentId: string | null;
  name: string;
  mimeType: string | null;
  size: number;
  thumbnailUrl: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  isTrashed: boolean;
  googleCreatedAt: string | null;
  googleModifiedAt: string | null;
  syncedAt: string;
  createdAt: string;
  driveEmail?: string;  // optional — not present in folder-browse responses
  isStarred?: boolean;
}


export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface FolderContents {
  folder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
}

export interface DriveFolder {
  id?: string;
  driveAccountId?: string;
  googleFolderId: string;
  googleParentId?: string | null;
  name: string;
  isSynced: boolean;
  syncedAt?: string | null;
  isStarred?: boolean;
}

export interface DriveFolderContents {
  folder: DriveFolder | null;
  subfolders: DriveFolder[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
}

export interface UploadInitResponse {
  uploadUrl: string;
  driveAccountId: string;
  googleFolderId: string;
}

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}
