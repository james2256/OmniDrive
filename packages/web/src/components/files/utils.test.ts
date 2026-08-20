// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isGoogleNative, getFolderIdentifier, isDriveFolder, isWorkspaceFolder } from './utils';
import type { DriveFolder, WorkspaceFolder } from '../../types';

describe('isGoogleNative', () => {
  it('returns true for Google Docs MIME type', () => {
    expect(isGoogleNative('application/vnd.google-apps.document')).toBe(true);
  });

  it('returns true for Google Sheets MIME type', () => {
    expect(isGoogleNative('application/vnd.google-apps.spreadsheet')).toBe(true);
  });

  it('returns true for Google Slides MIME type', () => {
    expect(isGoogleNative('application/vnd.google-apps.presentation')).toBe(true);
  });

  it('returns false for regular PDF', () => {
    expect(isGoogleNative('application/pdf')).toBe(false);
  });

  it('returns false for image', () => {
    expect(isGoogleNative('image/png')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isGoogleNative(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isGoogleNative(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isGoogleNative('')).toBe(false);
  });
});

describe('getFolderIdentifier', () => {
  it('returns googleFolderId for drive folders', () => {
    const folder = { googleFolderId: 'gfolder-1', id: 'db-1' };
    expect(getFolderIdentifier(folder)).toBe('gfolder-1');
  });

  it('returns id for workspace folders (no googleFolderId)', () => {
    const folder = { id: 'ws-folder-1' };
    expect(getFolderIdentifier(folder)).toBe('ws-folder-1');
  });

  it('returns undefined when neither is present', () => {
    const folder = {};
    expect(getFolderIdentifier(folder)).toBeUndefined();
  });

  it('returns googleFolderId when both are present (drive folder wins)', () => {
    const folder = { googleFolderId: 'gfolder-1', id: 'fallback-id' };
    expect(getFolderIdentifier(folder)).toBe('gfolder-1');
  });
});

describe('isDriveFolder', () => {
  const driveFolder: DriveFolder = {
    googleFolderId: 'gfolder-1',
    name: 'Drive Folder',
    isSynced: true,
  };

  const workspaceFolder: WorkspaceFolder = {
    id: 'ws-1',
    workspaceId: 'ws-root',
    name: 'Workspace Folder',
    parentId: null,
    icon: null,
    color: null,
    isStarred: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('returns true for a DriveFolder', () => {
    expect(isDriveFolder(driveFolder)).toBe(true);
  });

  it('returns false for a WorkspaceFolder', () => {
    expect(isDriveFolder(workspaceFolder)).toBe(false);
  });

  it('narrows to DriveFolder (type-level check via filter)', () => {
    const folders: (DriveFolder | WorkspaceFolder)[] = [driveFolder, workspaceFolder];
    const driveOnly = folders.filter(isDriveFolder);
    expect(driveOnly).toEqual([driveFolder]);
    // TypeScript narrows — driveOnly is DriveFolder[], so googleFolderId is accessible
    expect(driveOnly[0].googleFolderId).toBe('gfolder-1');
  });
});

describe('isWorkspaceFolder', () => {
  const driveFolder: DriveFolder = {
    googleFolderId: 'gfolder-1',
    name: 'Drive Folder',
    isSynced: true,
  };

  const workspaceFolder: WorkspaceFolder = {
    id: 'ws-1',
    workspaceId: 'ws-root',
    name: 'Workspace Folder',
    parentId: null,
    icon: null,
    color: null,
    isStarred: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('returns true for a WorkspaceFolder', () => {
    expect(isWorkspaceFolder(workspaceFolder)).toBe(true);
  });

  it('returns false for a DriveFolder', () => {
    expect(isWorkspaceFolder(driveFolder)).toBe(false);
  });

  it('narrows to WorkspaceFolder (type-level check via filter)', () => {
    const folders: (DriveFolder | WorkspaceFolder)[] = [driveFolder, workspaceFolder];
    const wsOnly = folders.filter(isWorkspaceFolder);
    expect(wsOnly).toEqual([workspaceFolder]);
    // TypeScript narrows — wsOnly is WorkspaceFolder[], so workspaceId is accessible
    expect(wsOnly[0].workspaceId).toBe('ws-root');
  });

  it('is the complement of isDriveFolder', () => {
    const folders: (DriveFolder | WorkspaceFolder)[] = [driveFolder, workspaceFolder];
    const driveOnly = folders.filter(isDriveFolder);
    const wsOnly = folders.filter(isWorkspaceFolder);
    expect(driveOnly.length + wsOnly.length).toBe(folders.length);
  });
});
