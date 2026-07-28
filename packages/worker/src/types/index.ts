// ─── types/index.ts — barrel ───
//
// This file is the permanent public entry point for the types package.
// It re-exports the contents of three sibling modules so consumers can
// keep writing `import { X } from '../types'` regardless of where X
// physically lives:
//
//   - domain.ts  : core domain interfaces (DriveAccount, FileEntry, …)
//   - db.ts      : D1 `*Row` shapes + `map*Row` mappers
//   - api.ts     : HTTP response / transport types (FolderContents, …)
//
// Note: this is a standard TypeScript barrel, not a backward-compat shim.
// New code is welcome to import directly from the sub-modules too.

export type {
  DriveAccount,
  VirtualFolder,
  FileEntry,
  SyncState,
  DriveFolder,
  SharedLink,
  QuotaCache,
  DriveWithQuota,
  AggregateQuota,
  S3Credential,
  AuditLog,
  Workspace,
  WorkspaceFolder,
} from './domain';

export {
  mapDriveRow,
  mapFolderRow,
  mapFileRow,
  mapDriveFolderRow,
  mapSharedLinkRow,
  mapS3CredentialRow,
  mapAuditLogRow,
  mapAutomationRuleRow,
  mapAutomationLogRow,
  mapWorkspaceRow,
  mapWorkspaceFolderRow,
} from './db';

export type {
  WorkspaceRow,
  WorkspaceFolderRow,
  FileRow,
  UserRow,
  DriveAccountRow,
  DriveFolderRow,
  SharedLinkRow,
  InvitationCodeRow,
  S3CredentialRow,
  S3MultipartUploadRow,
  AuditLogRow,
  AutomationRuleRow,
  WorkspacePolicyRow,
  S3MultipartPartRow,
  WorkspaceWithRoleRow,
} from './db';

export type { FolderContents, BreadcrumbItem, UploadInitResponse } from './api';

// OAuthTokens is defined in types/env.ts (the canonical version with
// authType and serviceAccount fields). Re-exported here for convenience.
export type { OAuthTokens } from './env';
