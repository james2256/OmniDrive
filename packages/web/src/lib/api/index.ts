// Barrel re-export — backward-compat shim so existing imports
// (import { api } from '../lib/api') continue to work during incremental migration.
// New code should import domain modules directly: import { filesApi } from '../lib/api/files'.

export { ApiError } from './core';
export { getFilePreviewUrl, fetchFilePreviewBlob } from './files';

// Re-export types that were in the old api.ts (now in types/index.ts).
// This lets existing `import type { SharedLink } from '../lib/api'` continue to work.
export type {
  LoginPayload,
  RegisterPayload,
  AdminCreateUserPayload,
  Invitation,
  S3Credential,
  SearchResults,
  SharedLink,
  SharedMetaResponse,
  CreateSharedLinkPayload,
} from '../../types';

import { authApi } from './auth';
import { adminApi } from './admin';
import { drivesApi } from './drives';
import { foldersApi } from './folders';
import { filesApi } from './files';
import { sharedApi } from './shared';
import { workspacesApi } from './workspaces';
import { s3Api } from './s3';
import { automationsApi } from './automations';

// Backward-compat flat api object — spreads all domain methods.
// This is a shim. Once all 47 import sites migrate to domain imports, delete this.
export const api = {
  ...authApi,
  ...adminApi,
  ...drivesApi,
  ...foldersApi,
  ...filesApi,
  ...sharedApi,
  ...workspacesApi,
  ...s3Api,
  ...automationsApi,
};

// Re-export standalone shared-link functions (were standalone exports in old api.ts).
// New code should use sharedApi.createSharedLink() etc.
export const createSharedLink = sharedApi.createSharedLink;
export const updateSharedLink = sharedApi.updateSharedLink;
export const getSharedLinks = sharedApi.getSharedLinks;
export const deleteSharedLink = sharedApi.deleteSharedLink;
export const getSharedMeta = sharedApi.getSharedMeta;
export const verifySharedPassword = sharedApi.verifySharedPassword;

// Re-export domain modules for new code.
export {
  authApi,
  adminApi,
  drivesApi,
  foldersApi,
  filesApi,
  sharedApi,
  workspacesApi,
  s3Api,
  automationsApi,
};
