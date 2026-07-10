import { describe, it, expect } from 'vitest';
import { resolveGoogleFolderId, resolveSyncRootFolderId } from '../src/lib/drive-folder';
import type { DriveAccount } from '../src/types';

const baseDrive: DriveAccount = {
  id: 'd1',
  userId: 'u1',
  googleAccountId: 'sa@test.iam.gserviceaccount.com',
  email: 'sa@test.iam.gserviceaccount.com',
  name: 'SA',
  type: 'service_account',
  isPrimary: false,
  rootFolderId: 'shared-folder-id',
  totalQuota: 0,
  usedQuota: 0,
  freeSpace: 0,
  usagePercent: 0,
  quotaUpdatedAt: null,
  createdAt: '',
};

describe('resolveGoogleFolderId', () => {
  it('maps root to configured shared folder for service accounts', () => {
    expect(resolveGoogleFolderId(baseDrive, 'root')).toBe('shared-folder-id');
  });

  it('keeps explicit folder ids unchanged', () => {
    expect(resolveGoogleFolderId(baseDrive, 'child-folder')).toBe('child-folder');
  });
});

describe('resolveSyncRootFolderId', () => {
  it('uses configured root for service accounts without calling Google API', async () => {
    const result = await resolveSyncRootFolderId(baseDrive, async () => {
      throw new Error('should not call Google root API');
    });
    expect(result).toBe('shared-folder-id');
  });

  it('falls back to Google root for oauth drives', async () => {
    const oauthDrive = { ...baseDrive, type: 'oauth' as const, rootFolderId: null };
    const result = await resolveSyncRootFolderId(oauthDrive, async () => 'google-root');
    expect(result).toBe('google-root');
  });
});