// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FileGridView } from './FileGridView';
import type { FileEntry, DriveFolder } from '../../types';
import type { ItemActions } from './types';

vi.mock('../../stores/useSelectionStore', () => ({
  useSelectionStore: (selector: (s: any) => any) =>
    selector({ selectedItems: [], selectAll: vi.fn(), clearSelection: vi.fn() }),
}));
vi.mock('./useItemInteractions', () => ({
  useItemInteractions: () => ({
    handleClick: vi.fn(),
    handleFileDoubleClick: vi.fn(),
    handleFolderDoubleClick: vi.fn(),
    handleFileHover: vi.fn(),
    handleFolderHover: vi.fn(),
    handleHoverEnd: vi.fn(),
  }),
}));
vi.mock('./ItemContextMenu', () => ({
  ItemContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const noopActions: ItemActions = {};
const renderDriveBadge = vi.fn(() => <span data-testid="drive-badge">📧</span>);
const getDriveInfo = vi.fn(() => ({ drive: null, index: 0 }));

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'file-1',
    userId: 'u1',
    driveAccountId: 'd1',
    googleFileId: 'g1',
    workspaceId: null,
    workspaceFolderId: null,
    googleParentId: 'root',
    name: 'test.txt',
    mimeType: 'text/plain',
    size: 100,
    thumbnailUrl: null,
    webViewLink: null,
    webContentLink: null,
    isTrashed: false,
    googleCreatedAt: null,
    googleModifiedAt: null,
    syncedAt: '2024-01-01',
    lastSyncedAt: null,
    syncStatus: 'idle',
    createdAt: '2024-01-01',
    ...overrides,
  };
}
function makeFolder(overrides: Partial<DriveFolder> = {}): DriveFolder {
  return {
    id: 'folder-1',
    driveAccountId: 'd1',
    googleFolderId: 'gf1',
    googleParentId: 'root',
    name: 'My Folder',
    isSynced: true,
    syncedAt: null,
    createdAt: '2024-01-01',
    ...overrides,
  };
}

describe('FileGridView — owner badge', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows 👤 badge for non-owned files (ownedByMe === false)', () => {
    render(
      <FileGridView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: false })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
      />,
    );
    expect(screen.getByTitle('Owned by another user')).toBeTruthy();
  });
  it('does NOT show 👤 badge for owned files (ownedByMe === true)', () => {
    render(
      <FileGridView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: true })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });
  it('does NOT show 👤 badge when ownedByMe is undefined (backward compat)', () => {
    render(
      <FileGridView
        sortedSubfolders={[]}
        sortedFiles={[makeFile()]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });
  it('shows 👤 badge for non-owned folders (ownedByMe === false)', () => {
    render(
      <FileGridView
        sortedSubfolders={[makeFolder({ ownedByMe: false })]}
        sortedFiles={[]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
      />,
    );
    expect(screen.getByTitle('Owned by another user')).toBeTruthy();
  });
  it('does NOT show 👤 badge for owned folders (ownedByMe === true)', () => {
    render(
      <FileGridView
        sortedSubfolders={[makeFolder({ ownedByMe: true })]}
        sortedFiles={[]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });
});
