// ─── Domain Types ───

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
  quotaUpdatedAt: string | null;
  createdAt: string;
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
}

export interface FileEntry {
  id: string;
  userId: string;
  driveAccountId: string;
  googleFileId: string;
  virtualFolderId: string | null;
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
}

export interface SyncState {
  driveAccountId: string;
  changeToken: string | null;
  lastSyncedAt: string | null;
  status: 'idle' | 'syncing' | 'error';
  errorMessage: string | null;
}

// ─── KV Types ───

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp ms
}

export interface QuotaCache {
  total: number;
  used: number;
  updatedAt: string;
}

// ─── API Response Types ───

export interface DriveWithQuota extends DriveAccount {
  freeSpace: number;
  usagePercent: number;
}

export interface AggregateQuota {
  totalQuota: number;
  totalUsed: number;
  totalFree: number;
  driveCount: number;
}

export interface FolderContents {
  folder: VirtualFolder | null;
  subfolders: VirtualFolder[];
  files: (FileEntry & { driveEmail: string })[];
  breadcrumb: BreadcrumbItem[];
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface UploadInitResponse {
  uploadUrl: string;
  driveAccountId: string;
  googleFolderId: string;
}

// ─── Row Mappers ───

export function mapUserRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    googleId: row.google_id as string,
    email: row.email as string,
    name: row.name as string,
    avatarUrl: (row.avatar_url as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapDriveRow(row: Record<string, unknown>): DriveAccount {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    googleAccountId: row.google_account_id as string,
    email: row.email as string,
    name: (row.name as string) ?? null,
    type: row.type as 'oauth' | 'service_account',
    isPrimary: row.is_primary === 1,
    rootFolderId: (row.root_folder_id as string) ?? null,
    totalQuota: (row.total_quota as number) ?? 0,
    usedQuota: (row.used_quota as number) ?? 0,
    quotaUpdatedAt: (row.quota_updated_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function mapFolderRow(row: Record<string, unknown>): VirtualFolder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    parentId: (row.parent_id as string) ?? null,
    icon: (row.icon as string) ?? '📁',
    color: (row.color as string) ?? '#4A90D9',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function mapFileRow(row: Record<string, unknown>): FileEntry {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    driveAccountId: row.drive_account_id as string,
    googleFileId: row.google_file_id as string,
    virtualFolderId: (row.virtual_folder_id as string) ?? null,
    name: row.name as string,
    mimeType: (row.mime_type as string) ?? null,
    size: (row.size as number) ?? 0,
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    webViewLink: (row.web_view_link as string) ?? null,
    webContentLink: (row.web_content_link as string) ?? null,
    isTrashed: row.is_trashed === 1,
    googleCreatedAt: (row.google_created_at as string) ?? null,
    googleModifiedAt: (row.google_modified_at as string) ?? null,
    syncedAt: row.synced_at as string,
    createdAt: row.created_at as string,
  };
}
