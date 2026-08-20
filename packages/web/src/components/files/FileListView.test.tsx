// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FileListView } from './FileListView';
import type { FileEntry, DriveFolder } from '../../types';
import type { ItemActions } from './types';

vi.mock('../../stores/useUIStore', () => ({
  useUIStore: (selector: (s: any) => any) =>
    selector({ sortField: 'name', sortDirection: 'asc', toggleSort: vi.fn(), viewMode: 'list' }),
}));
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
vi.mock('./MetadataBadges', () => ({ MetadataBadges: () => null }));

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

describe('FileListView — owner badge', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows 👤 badge for non-owned files (ownedByMe === false)', () => {
    render(
      <FileListView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: false })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.getByTitle('Owned by another user')).toBeTruthy();
  });
  it('does NOT show 👤 badge for owned files (ownedByMe === true)', () => {
    render(
      <FileListView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: true })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });
  it('does NOT show 👤 badge when ownedByMe is undefined (backward compat)', () => {
    render(
      <FileListView
        sortedSubfolders={[]}
        sortedFiles={[makeFile()]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });
  it('shows 👤 badge for non-owned folders (ownedByMe === false)', () => {
    render(
      <FileListView
        sortedSubfolders={[makeFolder({ ownedByMe: false })]}
        sortedFiles={[]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.getByTitle('Owned by another user')).toBeTruthy();
  });
  it('does NOT show 👤 badge for owned folders (ownedByMe === true)', () => {
    render(
      <FileListView
        sortedSubfolders={[makeFolder({ ownedByMe: true })]}
        sortedFiles={[]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });

  it('shows 👤 tooltip with owner email when ownerEmail is present (file)', () => {
    render(
      <FileListView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: false, ownerEmail: 'alice@example.com' })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.getByTitle('Owned by alice@example.com')).toBeTruthy();
    // Falls back to bare "Owned by another user" should NOT also be present.
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });

  it('shows 👤 tooltip with owner email when ownerEmail is present (folder)', () => {
    render(
      <FileListView
        sortedSubfolders={[makeFolder({ ownedByMe: false, ownerEmail: 'carol@example.com' })]}
        sortedFiles={[]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    expect(screen.getByTitle('Owned by carol@example.com')).toBeTruthy();
    expect(screen.queryByTitle('Owned by another user')).toBeNull();
  });

  it('passes ownerEmail as 3rd arg to renderDriveBadge', () => {
    render(
      <FileListView
        sortedSubfolders={[]}
        sortedFiles={[makeFile({ ownedByMe: false, ownerEmail: 'alice@example.com' })]}
        getDriveInfo={getDriveInfo}
        actions={noopActions}
        renderDriveBadge={renderDriveBadge}
        showDriveColumn={true}
      />,
    );
    // The 3rd positional arg to renderDriveBadge is ownerEmail.
    const lastCall = renderDriveBadge.mock.calls.at(-1);
    expect(lastCall?.[2]).toBe('alice@example.com');
  });
});
