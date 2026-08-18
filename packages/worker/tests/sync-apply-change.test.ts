import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyChange, type ApplyChangeContext } from '../src/services/sync';
import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { DriveAccount } from '../src/types/domain';
import type { GDriveFile } from '../src/types/google';
import type { FileStateForStats } from '../src/lib/storage-stats';

// ─── Mock stubs — repositories are mocked so applyChange can call *Stmt
// methods without needing a real D1 binding ───

function makeStmt(): D1PreparedStatement {
  return {} as D1PreparedStatement;
}

function makeCtx(overrides: Partial<ApplyChangeContext> = {}): ApplyChangeContext {
  return {
    drive: makeDrive(),
    rootFolderId: 'root-id',
    fileRepo: {
      applyStorageDeltaStmt: vi.fn(() => makeStmt()),
      deleteByDriveAndGoogleIdStmt: vi.fn(() => makeStmt()),
      markTrashedByDriveAndGoogleIdStmt: vi.fn(() => makeStmt()),
      buildUpsertStmt: vi.fn(() => makeStmt()),
    },
    folderRepo: {
      buildDriveFolderUpsertStmt: vi.fn(() => makeStmt()),
    },
    driveRepo: {
      deleteDriveFolderStmt: vi.fn(() => makeStmt()),
      markDriveFolderTrashedStmt: vi.fn(() => makeStmt()),
    },
    ...overrides,
  } as unknown as ApplyChangeContext;
}

// ─── Fixtures ───

function makeDrive(overrides: Partial<DriveAccount> = {}): DriveAccount {
  return {
    id: 'drive-1',
    userId: 'user-1',
    googleAccountId: 'g-1',
    email: 'test@example.com',
    name: 'Test Drive',
    type: 'oauth',
    isPrimary: false,
    rootFolderId: null,
    totalQuota: 1000,
    usedQuota: 100,
    quotaOverride: null,
    quotaUpdatedAt: null,
    syncStatus: 'idle',
    syncErrorMessage: null,
    syncPaused: false,
    lastSyncedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeFile(overrides: Partial<GDriveFile> = {}): GDriveFile {
  return {
    id: 'file-1',
    name: 'report.pdf',
    mimeType: 'application/pdf',
    size: '1000',
    createdTime: '2024-01-01T00:00:00Z',
    modifiedTime: '2024-01-01T00:00:00Z',
    owners: [{ me: true }],
    ...overrides,
  };
}

// ─── Tests ───

describe('applyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Removed ───

  it('returns 2 units (folder delete + file delete) with negative delta when removed=true and oldState exists', () => {
    const ctx = makeCtx();
    const oldState: FileStateForStats = {
      size: 1000,
      mimeType: 'application/pdf',
      isTrashed: false,
      ownedByMe: true,
    };
    const result = applyChange({ fileId: 'file-1', removed: true }, oldState, ctx);

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(2);
    expect(result!.newState).toBeNull();
    // First unit: folder delete (no deltas)
    expect(result!.units[0]!.deltas).toHaveLength(0);
    // Second unit: file delete (with negative delta for the old owned size)
    expect(result!.units[1]!.deltas.length).toBeGreaterThan(0);
  });

  it('returns 2 units with no delta when removed=true and oldState is null (new file removed)', () => {
    const ctx = makeCtx();
    const result = applyChange({ fileId: 'file-1', removed: true }, null, ctx);

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(2);
    expect(result!.units[0]!.deltas).toHaveLength(0);
    expect(result!.units[1]!.deltas).toHaveLength(0); // No delta — file didn't exist
    expect(result!.newState).toBeNull();
  });

  // ─── 2. Skip cases ───

  it('returns null when file is missing (no metadata)', () => {
    const ctx = makeCtx();
    const result = applyChange({ fileId: 'file-1', removed: false, file: undefined }, null, ctx);
    expect(result).toBeNull();
  });

  it('returns null when file is a shortcut', () => {
    const ctx = makeCtx();
    const file = makeFile({ mimeType: 'application/vnd.google-apps.shortcut' });
    const result = applyChange({ fileId: 'file-1', removed: false, file }, null, ctx);
    expect(result).toBeNull();
  });

  // ─── 3. Trashed ───

  it('returns 1 unit with markTrashed stmt + negative delta for trashed file', () => {
    const ctx = makeCtx();
    const file = makeFile({ trashed: true });
    const oldState: FileStateForStats = {
      size: 1000,
      mimeType: 'application/pdf',
      isTrashed: false,
      ownedByMe: true,
    };
    const result = applyChange({ fileId: 'file-1', removed: false, file }, oldState, ctx);

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(1);
    expect(result!.units[0]!.deltas.length).toBeGreaterThan(0);
    expect(result!.newState).toEqual({
      size: 1000,
      mimeType: 'application/pdf',
      isTrashed: true,
      ownedByMe: true,
    });
  });

  it('returns 1 unit with no delta for trashed folder', () => {
    const ctx = makeCtx();
    const file = makeFile({
      mimeType: 'application/vnd.google-apps.folder',
      trashed: true,
    });
    const result = applyChange({ fileId: 'folder-1', removed: false, file }, null, ctx);

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(1);
    expect(result!.units[0]!.deltas).toHaveLength(0);
    expect(result!.newState).toBeNull(); // Folders don't have storage state
  });

  // ─── 4. Active (upsert) ───

  it('returns 1 unit with upsert stmt + positive delta for new active file', () => {
    const ctx = makeCtx();
    const file = makeFile({ size: '5000' });
    const result = applyChange(
      { fileId: 'file-1', removed: false, file },
      null, // oldState=null → new file
      ctx,
    );

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(1);
    expect(result!.units[0]!.deltas.length).toBeGreaterThan(0);
    expect(result!.newState).toEqual({
      size: 5000,
      mimeType: 'application/pdf',
      isTrashed: false,
      ownedByMe: true,
    });
  });

  it('returns 1 unit with no delta for active folder upsert', () => {
    const ctx = makeCtx();
    const file = makeFile({ mimeType: 'application/vnd.google-apps.folder' });
    const result = applyChange({ fileId: 'folder-1', removed: false, file }, null, ctx);

    expect(result).not.toBeNull();
    expect(result!.units).toHaveLength(1);
    expect(result!.units[0]!.deltas).toHaveLength(0);
    expect(result!.newState).toBeNull(); // Folders don't have storage state
  });
});
