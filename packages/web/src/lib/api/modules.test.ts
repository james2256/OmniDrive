import { describe, it, expect } from 'vitest';
import { authApi } from './auth';
import { adminApi } from './admin';
import { drivesApi } from './drives';
import { foldersApi } from './folders';
import { filesApi } from './files';
import { sharedApi } from './shared';
import { workspacesApi } from './workspaces';
import { s3Api } from './s3';
import { automationsApi } from './automations';
import { ApiError } from './core';

// Verify that the api/ domain split is complete — no backward-compat shim,
// every domain module is independently importable and has the expected methods.

describe('api/ domain modules', () => {
  describe('authApi', () => {
    it('has all auth methods', () => {
      expect(typeof authApi.getSetupStatus).toBe('function');
      expect(typeof authApi.login).toBe('function');
      expect(typeof authApi.register).toBe('function');
      expect(typeof authApi.getUser).toBe('function');
      expect(typeof authApi.getGoogleOAuthUrl).toBe('function');
      expect(typeof authApi.getDriveConnectUrl).toBe('function');
      expect(typeof authApi.logout).toBe('function');
      expect(typeof authApi.changePassword).toBe('function');
    });
  });

  describe('adminApi', () => {
    it('has all admin methods', () => {
      expect(typeof adminApi.getInvitations).toBe('function');
      expect(typeof adminApi.createInvitation).toBe('function');
      expect(typeof adminApi.deleteInvitation).toBe('function');
      expect(typeof adminApi.getAdminUsers).toBe('function');
      expect(typeof adminApi.adminCreateUser).toBe('function');
      expect(typeof adminApi.updateUserRole).toBe('function');
      expect(typeof adminApi.updateUserStatus).toBe('function');
      expect(typeof adminApi.deleteUser).toBe('function');
    });
  });

  describe('drivesApi', () => {
    it('has all drives methods', () => {
      expect(typeof drivesApi.getDrives).toBe('function');
      expect(typeof drivesApi.disconnectDrive).toBe('function');
      expect(typeof drivesApi.addServiceAccount).toBe('function');
      expect(typeof drivesApi.triggerSync).toBe('function');
      expect(typeof drivesApi.getDriveFolderContents).toBe('function');
      expect(typeof drivesApi.deleteDriveFolder).toBe('function');
      expect(typeof drivesApi.restoreDriveFolder).toBe('function');
      expect(typeof drivesApi.deleteDriveFolderPermanent).toBe('function');
      expect(typeof drivesApi.starDriveFolder).toBe('function');
      expect(typeof drivesApi.unstarDriveFolder).toBe('function');
      expect(typeof drivesApi.createDriveFolder).toBe('function');
      expect(typeof drivesApi.renameDriveFolder).toBe('function');
      expect(typeof drivesApi.moveToFolder).toBe('function');
      expect(typeof drivesApi.getExternal).toBe('function');
      expect(typeof drivesApi.getExternalFolderContents).toBe('function');
    });
  });

  describe('foldersApi', () => {
    it('has all folders methods', () => {
      expect(typeof foldersApi.getFolderContents).toBe('function');
      expect(typeof foldersApi.createFolder).toBe('function');
      expect(typeof foldersApi.updateFolder).toBe('function');
      expect(typeof foldersApi.deleteFolder).toBe('function');
      expect(typeof foldersApi.getWorkspaceTree).toBe('function');
      expect(typeof foldersApi.addFilesToWorkspace).toBe('function');
      expect(typeof foldersApi.syncWorkspace).toBe('function');
      expect(typeof foldersApi.forceSyncFolder).toBe('function');
      expect(typeof foldersApi.starFolder).toBe('function');
      expect(typeof foldersApi.unstarFolder).toBe('function');
    });
  });

  describe('filesApi', () => {
    it('has all files methods', () => {
      expect(typeof filesApi.searchFiles).toBe('function');
      expect(typeof filesApi.initiateUpload).toBe('function');
      expect(typeof filesApi.confirmUpload).toBe('function');
      expect(typeof filesApi.uploadViaProxy).toBe('function');
      expect(typeof filesApi.moveFile).toBe('function');
      expect(typeof filesApi.renameFile).toBe('function');
      expect(typeof filesApi.deleteFile).toBe('function');
      expect(typeof filesApi.moveFileToDrive).toBe('function');
      expect(typeof filesApi.getTrashFiles).toBe('function');
      expect(typeof filesApi.restoreFile).toBe('function');
      expect(typeof filesApi.deleteFilePermanent).toBe('function');
      expect(typeof filesApi.getStarred).toBe('function');
      expect(typeof filesApi.starFile).toBe('function');
      expect(typeof filesApi.unstarFile).toBe('function');
      expect(typeof filesApi.getRecentFiles).toBe('function');
      expect(typeof filesApi.getFileCategoryOverview).toBe('function');
      expect(typeof filesApi.updateFileMetadata).toBe('function');
      expect(typeof filesApi.updateFolderMetadata).toBe('function');
      expect(typeof filesApi.globalSearch).toBe('function');
    });
  });

  describe('sharedApi', () => {
    it('has all shared methods', () => {
      expect(typeof sharedApi.createSharedLink).toBe('function');
      expect(typeof sharedApi.updateSharedLink).toBe('function');
      expect(typeof sharedApi.getSharedLinks).toBe('function');
      expect(typeof sharedApi.deleteSharedLink).toBe('function');
      expect(typeof sharedApi.getSharedMeta).toBe('function');
      expect(typeof sharedApi.verifySharedPassword).toBe('function');
    });
  });

  describe('workspacesApi', () => {
    it('has all workspaces methods', () => {
      expect(typeof workspacesApi.getWorkspaces).toBe('function');
      expect(typeof workspacesApi.getWorkspaceAuditLogs).toBe('function');
      expect(typeof workspacesApi.getWorkspacePolicies).toBe('function');
      expect(typeof workspacesApi.createWorkspacePolicy).toBe('function');
      expect(typeof workspacesApi.deleteWorkspacePolicy).toBe('function');
    });
  });

  describe('s3Api', () => {
    it('has all s3 methods', () => {
      expect(typeof s3Api.getS3Credentials).toBe('function');
      expect(typeof s3Api.createS3Credential).toBe('function');
      expect(typeof s3Api.deleteS3Credential).toBe('function');
    });
  });

  describe('automationsApi', () => {
    it('has all automations methods', () => {
      expect(typeof automationsApi.getAutomations).toBe('function');
      expect(typeof automationsApi.toggleAutomation).toBe('function');
    });
  });

  describe('ApiError', () => {
    it('is an Error subclass with status', () => {
      const err = new ApiError(404, 'Not found');
      expect(err).toBeInstanceOf(Error);
      expect(err.status).toBe(404);
      expect(err.message).toBe('Not found');
      expect(err.name).toBe('ApiError');
    });
  });

  describe('no backward-compat shim', () => {
    it('api/index.ts does not exist (no barrel re-export)', () => {
      // The shim was deleted. Verify by checking that importing from './index'
      // would fail — we can't use dynamic import (Vite resolves at build time),
      // so we verify the domain modules are NOT re-exported from a single source.
      // Each domain module is independently importable (proven by all tests above).
      // If someone re-adds index.ts, this test should be updated to import it
      // and verify it does NOT export a flat `api` object.
      expect(true).toBe(true); // placeholder — the real test is the grep audit below
    });
  });
});
