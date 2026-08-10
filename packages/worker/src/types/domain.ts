// ─── Domain Types ───
//
// Core domain models for the application. These interfaces describe the
// shape of business objects as they flow through services and routes,
// independent of how they are persisted (D1 row shapes live in db.ts).
//
// Mapper functions in db.ts convert raw D1 rows into these domain types.

import type { SyncStatus } from './sync-status';

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
  quotaUpdatedAt: string | null;
  syncStatus: SyncStatus;
  syncErrorMessage: string | null;
  syncPaused: boolean;
  lastSyncedAt: string | null;
  health?: 'connected' | 'auth_expired' | 'error';
  createdAt: string;
}

export interface VirtualFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
  isStarred: boolean;
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
  isStarred: boolean;
  ownedByMe: boolean;
  metadata: string;
  googleCreatedAt: string | null;
  googleModifiedAt: string | null;
  syncedAt: string;
  lastSyncedAt: string | null;
  syncStatus: SyncStatus;
  createdAt: string;
}

export interface SyncState {
  driveAccountId: string;
  changeToken: string | null;
  lastSyncedAt: string | null;
  status: SyncStatus;
  errorMessage: string | null;
}

export interface DriveFolder {
  id: string;
  driveAccountId: string;
  googleFolderId: string;
  googleParentId: string | null;
  name: string;
  isSynced: boolean;
  syncedAt: string | null;
  createdAt: string;
  isTrashed?: boolean;
  isStarred?: boolean;
  ownedByMe?: boolean;
}

export interface SharedLink {
  id: string;
  userId: string;
  targetType: 'file' | 'folder';
  targetId: string;
  targetName?: string;
  targetMimeType?: string | null;
  passwordHash?: string | null;
  expiresAt?: string | null;
  allowDownloads: boolean;
  allowUploads: boolean;
  maxDownloads?: number | null;
  requireEmail: boolean;
  webhookUrl?: string | null;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
}

// ─── KV Types ───

export interface QuotaCache {
  v?: number;
  total: number;
  used: number;
  hasLimit: boolean;
  updatedAt: string;
}

export interface DriveWithQuota extends DriveAccount {
  freeSpace: number;
  usagePercent: number;
  // ponytail: derived from the branches /drives GET already runs; no stored column.
  health?: 'connected' | 'auth_expired' | 'error';
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface S3Credential {
  id: string;
  description: string | null;
  accessKeyId: string;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
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

export interface Workspace {
  id: string;
  name: string;
  ownerId: string;
  usedBytes?: number;
  syncTtlMinutes: number;
  createdAt: string;
  updatedAt: string;
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
