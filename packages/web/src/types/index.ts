// Auth API contract — what /api/auth/me, /login, /register return.
// Matches worker's SessionData (packages/worker/src/types/env.ts).
import type { SyncStatus } from './sync-status';

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
  hasLimit?: boolean;
  syncStatus?: SyncStatus;
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
  syncStatus: SyncStatus;
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
  syncStatus: SyncStatus;
  createdAt: string;
  driveEmail?: string; // optional — not present in folder-browse responses
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
  actorEmail: string | null;
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

export interface RuleCondition {
  field: 'name' | 'extension';
  operator: 'endswith' | 'contains' | 'equals';
  value: string;
}

export interface RuleAction {
  type: 'move' | 'delete';
  targetFolderId?: string;
}

export interface AutomationRule {
  id: string;
  userId: string;
  name: string;
  triggerType: 'event' | 'cron';
  triggerConfig: Record<string, unknown>;
  conditions: RuleCondition[];
  actions: RuleAction[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  ruleId: string;
  status: string;
  details: string | null;
  executedAt: string;
}

// ─── API payload/response types (moved from lib/api.ts) ───

export interface LoginPayload {
  username: string;
  password: string;
}

export interface RegisterPayload extends LoginPayload {
  name?: string;
  email?: string;
  invitation_code?: string;
}

export interface AdminCreateUserPayload {
  username: string;
  password: string;
  name?: string;
  email?: string;
  role?: string;
}

export interface Invitation {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface S3Credential {
  id: string;
  description: string | null;
  accessKeyId: string;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
}

/** Search results from GET /api/files/search — files + workspace folders + drive folders. */
export interface SearchResults {
  folder: null;
  subfolders: (WorkspaceFolder | DriveFolder)[];
  files: FileEntry[];
  breadcrumb: BreadcrumbItem[];
  query: string;
}

export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  targetName?: string;
  targetMimeType?: string | null;
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
  targetName?: string;
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
