// Auth API contract — what /api/auth/me, /login, /register return.
// Matches worker's SessionData (packages/worker/src/types/env.ts).
export interface SessionData {
  userId: string;
  username: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  role: 'super_admin' | 'member';
  createdAt: number;
}

// Admin API contract — what /api/admin/users returns (both list and create).
export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: 'super_admin' | 'member';
  status: 'active' | 'blocked';
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
  quotaOverride: number | null;
  freeSpace: number;
  usagePercent: number;
  syncStatus?: 'idle' | 'syncing' | 'error';
  syncErrorMessage?: string | null;
  syncPaused?: boolean;
  health?: 'connected' | 'auth_expired' | 'error';
  lastSyncedAt?: string | null;
  quotaUpdatedAt: string | null;
  createdAt: string;
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  role?: string;
  usedBytes?: number;
  syncTtlMinutes: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: 'viewer' | 'commenter' | 'editor' | 'manager' | 'auditor' | 'owner';
  joinedAt: string;
}

export interface WorkspaceFolder {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  icon: string | null;
  color: string | null;
  metadata?: string | Record<string, string>;
  isStarred: boolean;
  lastSyncedAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  createdAt: string;
  updatedAt: string;
}

export interface FileEntry {
  id: string;
  userId: string;
  driveAccountId: string;
  googleFileId: string;
  workspaceId: string | null;
  workspaceFolderId: string | null;
  googleParentId: string | null;
  name: string;
  mimeType: string | null;
  size: number;
  thumbnailUrl: string | null;
  webViewLink: string | null;
  webContentLink: string | null;
  isTrashed: boolean;
  metadata?: string | Record<string, string>;
  googleCreatedAt: string | null;
  googleModifiedAt: string | null;
  syncedAt: string;
  lastSyncedAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'error';
  createdAt: string;
  driveEmail?: string;  // optional — not present in folder-browse responses
  isStarred?: boolean;
}


export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface FolderContents {
  folder: WorkspaceFolder | null;
  subfolders: WorkspaceFolder[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
  pagination?: PaginationMeta;
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
  isTrashed?: boolean;
  driveId?: string;
  driveEmail?: string;
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
  removing?: boolean;
}

export interface AuditLog {
  id: string;
  workspaceId: string | null;
  actorId: string;
  actionType: string;
  resourceId: string | null;
  resourceName: string | null;
  metadata: string | null;
  createdAt: string;
}

export interface WorkspacePolicy {
  id: string;
  workspaceId: string;
  targetType: 'workspace' | 'folder';
  targetId: string | null;
  policyType: 'storage_quota' | 'data_retention';
  config: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  triggerType: string;
  isActive: boolean;
}
