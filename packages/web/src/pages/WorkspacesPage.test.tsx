// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { WorkspacesPage } from './WorkspacesPage';
import { useDrives } from '../hooks/useDrives';
import { useQuery } from '@tanstack/react-query';

// Stable mock refs.
const foldersApiMock = vi.hoisted(() => ({
  getWorkspaceTree: vi.fn(),
  getFolderContents: vi.fn(),
  updateFolder: vi.fn(() => Promise.resolve()),
  deleteFolder: vi.fn(() => Promise.resolve()),
  syncWorkspace: vi.fn(() => Promise.resolve()),
}));
const workspacesApiMock = vi.hoisted(() => ({
  createWorkspacePolicy: vi.fn(() => Promise.resolve()),
}));
const filesApiMock = vi.hoisted(() => ({
  moveFile: vi.fn(() => Promise.resolve()),
}));
const addToastMock = vi.hoisted(() => vi.fn());
const invalidateQueriesMock = vi.hoisted(() => vi.fn());
const clearSelectionMock = vi.hoisted(() => vi.fn());
const itemModals = vi.hoisted(() => ({
  setPreviewFile: vi.fn(),
  setShareTarget: vi.fn(),
  setMoveDriveFiles: vi.fn(),
  setMoveTarget: vi.fn(),
  setFolderDownloadTarget: vi.fn(),
  setWorkspaceTarget: vi.fn(),
  handleRenameFileRequest: vi.fn(),
  handleRenameFolderRequest: vi.fn(),
  handleDeleteFile: vi.fn(),
  handleDeleteFolder: vi.fn(),
  toggleStar: vi.fn(),
  handleViewInfo: vi.fn(),
}));

vi.mock('../lib/api/workspaces', () => ({ workspacesApi: workspacesApiMock }));
vi.mock('../lib/api/folders', () => ({ foldersApi: foldersApiMock }));
vi.mock('../lib/api/files', () => ({ filesApi: filesApiMock }));
vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn(), useGetDriveInfo: () => vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(() => ({ data: [] })),
  useIsTargetSharedCallback: () => vi.fn(),
}));
vi.mock('../hooks/useItemModals', () => ({ useItemModals: () => itemModals }));
vi.mock('../stores/useToastStore', () => ({
  useToastStore: (selector: any) => selector({ addToast: addToastMock }),
}));
vi.mock('../stores/useSelectionStore', () => ({
  useSelectionStore: (selector: any) => selector({ clearSelection: clearSelectionMock }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
vi.mock('../lib/queryKeys', () => ({
  qk: {
    workspaceTree: ['workspaceTree'],
    workspaceContents: (id: string) => ['workspaceContents', id],
  },
}));

vi.mock('../components/workspaces/WorkspaceSidebar', () => ({
  WorkspaceSidebar: ({
    folders,
    activeFolderId,
    onSelect,
    onRename,
    onDelete,
    onNewSubfolder,
  }: any) => (
    <div data-testid="workspace-sidebar" data-folder-count={folders.length}>
      <span data-testid="active-folder">{activeFolderId ?? 'null'}</span>
      {folders.map((f: any) => (
        <div key={f.id} data-testid={`folder-${f.id}`}>
          <span>{f.name}</span>
          <button data-testid={`select-${f.id}`} onClick={() => onSelect(f.id)}>
            Select {f.name}
          </button>
          <button data-testid={`rename-${f.id}`} onClick={() => onRename(f.id)}>
            Rename
          </button>
          <button data-testid={`delete-${f.id}`} onClick={() => onDelete(f.id)}>
            Delete
          </button>
        </div>
      ))}
      <button data-testid="new-workspace-btn" onClick={() => onNewSubfolder(null)}>
        New Workspace
      </button>
    </div>
  ),
}));

vi.mock('../components/workspaces/WorkspaceMainView', () => ({
  WorkspaceMainView: ({
    activeFolder,
    path,
    onCreateFolder,
    onCreateRootFolder,
    onSync,
    isSyncing,
    fileTabProps,
    onToggleSidebar,
  }: any) => (
    <div data-testid="workspace-main-view">
      <span data-testid="active-folder-name">{activeFolder?.name ?? 'null'}</span>
      <span data-testid="path">{path.map((p: any) => p.name).join('/')}</span>
      <span data-testid="is-syncing">{String(isSyncing)}</span>
      <span data-testid="file-count">{fileTabProps?.files?.length ?? 0}</span>
      <span data-testid="subfolder-count">{fileTabProps?.subfolders?.length ?? 0}</span>
      <button data-testid="create-folder-btn" onClick={onCreateFolder}>
        Create Folder
      </button>
      <button data-testid="create-root-btn" onClick={onCreateRootFolder}>
        Create Root
      </button>
      <button data-testid="sync-btn" onClick={onSync}>
        Sync
      </button>
      <button data-testid="toggle-sidebar-btn" onClick={onToggleSidebar}>
        Toggle Sidebar
      </button>
      <button
        data-testid="retention-btn"
        onClick={() => fileTabProps?.actions?.onSetRetentionPolicy?.('target-1', 'folder')}
      >
        Retention
      </button>
    </div>
  ),
}));

vi.mock('../components/CreateFolderModal', () => ({
  CreateFolderModal: ({ open, parentId, title, onClose, onSuccess }: any) =>
    open ? (
      <div data-testid="create-folder-modal" data-parent-id={parentId ?? 'null'} data-title={title}>
        <button data-testid="close-create-folder" onClick={onClose}>
          Cancel
        </button>
        <button data-testid="success-create-folder" onClick={onSuccess}>
          Success
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, title, message }: any) =>
    open ? (
      <div data-testid="confirm-dialog" data-title={title} data-message={message}>
        <button data-testid="confirm-button" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/RenameDialog', () => ({
  RenameDialog: ({ open, initialName, title, onConfirm, onClose }: any) =>
    open ? (
      <div data-testid="rename-dialog" data-initial={initialName} data-title={title}>
        <button data-testid="rename-confirm" onClick={() => onConfirm('New Name')}>
          Confirm
        </button>
        <button data-testid="rename-close" onClick={onClose}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/workspaces/SetRetentionPolicyDialog', () => ({
  SetRetentionPolicyDialog: ({ open, onClose, onSubmit }: any) =>
    open ? (
      <div data-testid="retention-dialog">
        <button data-testid="retention-close" onClick={onClose}>
          Close
        </button>
        <button data-testid="retention-submit" onClick={() => onSubmit('auto_delete', 30)}>
          Submit
        </button>
      </div>
    ) : null,
}));

vi.mock('../components/files/ItemModals', () => ({ ItemModals: () => null }));

vi.mock('../components/EmptyState', () => ({
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ListSkeleton: ({ rows }: any) => (
    <div data-testid="skeleton" data-rows={rows}>
      Loading...
    </div>
  ),
}));

const sampleFolder = {
  id: 'ws-folder-1',
  workspaceId: 'ws1',
  name: 'My Workspace',
  parentId: null,
  icon: null,
  color: null,
  isStarred: false,
  lastSyncedAt: null,
  syncStatus: 'idle' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const sampleFile = {
  id: 'f1',
  name: 'doc.pdf',
  mimeType: 'application/pdf',
};

const sampleSubfolder = {
  id: 'sub-folder-1',
  workspaceId: 'ws1',
  name: 'Subfolder',
  parentId: 'ws-folder-1',
  icon: null,
  color: null,
  isStarred: false,
  lastSyncedAt: null,
  syncStatus: 'idle' as const,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('WorkspacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'u@gmail.com' }] },
    });
    (useQuery as Mock).mockImplementation((opts: any) => {
      if (opts.queryKey[0] === 'workspaceTree') {
        return { data: { folders: [sampleFolder] }, isLoading: false };
      }
      if (opts.queryKey[0] === 'workspaceContents') {
        return {
          data: { files: [sampleFile], subfolders: [sampleSubfolder] },
        };
      }
      return { data: undefined };
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading skeleton when workspace tree is loading', () => {
    (useQuery as Mock).mockImplementation((opts: any) => {
      if (opts.queryKey[0] === 'workspaceTree') {
        return { data: undefined, isLoading: true };
      }
      return { data: undefined };
    });
    render(<WorkspacesPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
    // Sidebar not rendered while loading.
    expect(screen.queryByTestId('workspace-sidebar')).toBeNull();
  });

  it('renders workspace sidebar with folders from tree data', () => {
    render(<WorkspacesPage />);
    expect(screen.getByTestId('workspace-sidebar')).toBeTruthy();
    expect(screen.getByText('My Workspace')).toBeTruthy();
  });

  it('selects a folder when sidebar select clicked', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    expect(screen.getByTestId('active-folder-name').textContent).toBe('My Workspace');
  });

  it('renders folder contents (files and subfolders) in main view', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    expect(screen.getByTestId('file-count').textContent).toBe('1');
    expect(screen.getByTestId('subfolder-count').textContent).toBe('1');
  });

  it('renders breadcrumb path in main view when folder selected', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    expect(screen.getByTestId('path').textContent).toBe('My Workspace');
  });

  it('calls foldersApi.syncWorkspace and invalidates contents on sync', async () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('sync-btn'));
    await waitFor(() => {
      expect(foldersApiMock.syncWorkspace).toHaveBeenCalledWith('ws-folder-1');
    });
    expect(addToastMock).toHaveBeenCalledWith('success', 'Sync started.');
    expect(invalidateQueriesMock).toHaveBeenCalledWith({
      queryKey: ['workspaceContents', 'ws-folder-1'],
    });
  });

  it('shows error toast when sync fails', async () => {
    foldersApiMock.syncWorkspace.mockRejectedValueOnce(new Error('fail'));
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('sync-btn'));
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('error', 'Failed to start sync');
    });
  });

  it('opens create folder modal with New Workspace title when Create Root clicked', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('create-root-btn'));
    const modal = screen.getByTestId('create-folder-modal');
    expect(modal.getAttribute('data-title')).toBe('New Workspace');
    expect(modal.getAttribute('data-parent-id')).toBe('null');
  });

  it('opens create folder modal with New Folder title when Create Folder clicked', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('create-folder-btn'));
    const modal = screen.getByTestId('create-folder-modal');
    expect(modal.getAttribute('data-title')).toBe('New Folder');
    expect(modal.getAttribute('data-parent-id')).toBe('ws-folder-1');
  });

  it('invalidates workspace tree when create folder modal succeeds', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('create-root-btn'));
    fireEvent.click(screen.getByTestId('success-create-folder'));
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workspaceTree'] });
  });

  it('opens rename dialog when sidebar rename clicked', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('rename-ws-folder-1'));
    const dialog = screen.getByTestId('rename-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('data-initial')).toBe('My Workspace');
    expect(dialog.getAttribute('data-title')).toBe('Rename Workspace');
  });

  it('renames workspace and invalidates tree on confirm', async () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('rename-ws-folder-1'));
    fireEvent.click(screen.getByTestId('rename-confirm'));
    await waitFor(() => {
      expect(foldersApiMock.updateFolder).toHaveBeenCalledWith('ws-folder-1', { name: 'New Name' });
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workspaceTree'] });
  });

  it('shows error toast when rename fails', async () => {
    foldersApiMock.updateFolder.mockRejectedValueOnce(new Error('fail'));
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('rename-ws-folder-1'));
    fireEvent.click(screen.getByTestId('rename-confirm'));
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('error', 'Failed to rename workspace');
    });
  });

  it('opens confirm dialog when sidebar delete clicked', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('delete-ws-folder-1'));
    const dialog = screen.getByTestId('confirm-dialog');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('data-title')).toBe('Delete Workspace');
  });

  it('deletes workspace and invalidates tree on confirm', async () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('delete-ws-folder-1'));
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(foldersApiMock.deleteFolder).toHaveBeenCalledWith('ws-folder-1');
    });
    expect(invalidateQueriesMock).toHaveBeenCalledWith({ queryKey: ['workspaceTree'] });
  });

  it('clears active folder when deleting the currently selected workspace', async () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    expect(screen.getByTestId('active-folder-name').textContent).toBe('My Workspace');
    fireEvent.click(screen.getByTestId('delete-ws-folder-1'));
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(foldersApiMock.deleteFolder).toHaveBeenCalledWith('ws-folder-1');
    });
    expect(screen.getByTestId('active-folder-name').textContent).toBe('null');
  });

  it('shows error toast when delete fails', async () => {
    foldersApiMock.deleteFolder.mockRejectedValueOnce(new Error('fail'));
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('delete-ws-folder-1'));
    fireEvent.click(screen.getByTestId('confirm-button'));
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('error', 'Failed to delete workspace');
    });
  });

  it('opens retention policy dialog when retention action triggered', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('retention-btn'));
    expect(screen.getByTestId('retention-dialog')).toBeTruthy();
  });

  it('creates workspace policy on retention dialog submit', async () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('retention-btn'));
    fireEvent.click(screen.getByTestId('retention-submit'));
    await waitFor(() => {
      expect(workspacesApiMock.createWorkspacePolicy).toHaveBeenCalledWith('ws1', {
        targetType: 'folder',
        targetId: 'target-1',
        policyType: 'data_retention',
        config: { action: 'auto_delete', days: 30 },
      });
    });
    expect(addToastMock).toHaveBeenCalledWith('success', 'Policy applied successfully');
  });

  it('shows error toast when retention policy submission fails', async () => {
    workspacesApiMock.createWorkspacePolicy.mockRejectedValueOnce(new Error('fail'));
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    fireEvent.click(screen.getByTestId('retention-btn'));
    fireEvent.click(screen.getByTestId('retention-submit'));
    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith('error', 'Failed to apply policy');
    });
  });

  it('does not create policy when no active folder is selected', async () => {
    render(<WorkspacesPage />);
    // Don't select a folder first — activeFolderId is null.
    fireEvent.click(screen.getByTestId('retention-btn'));
    expect(screen.getByTestId('retention-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retention-submit'));
    // No API call because activeFolderId is null.
    await waitFor(() => {
      expect(workspacesApiMock.createWorkspacePolicy).not.toHaveBeenCalled();
    });
  });

  it('clears selection when navigating between folders', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    // useEffect on [activeFolderId, clearSelection] fires when activeFolderId changes.
    expect(clearSelectionMock).toHaveBeenCalled();
  });

  it('passes the file-tab actions (preview, share, etc.) to main view', () => {
    render(<WorkspacesPage />);
    fireEvent.click(screen.getByTestId('select-ws-folder-1'));
    // The retention-btn was wired to fileTabProps.actions.onSetRetentionPolicy —
    // clicking it opens the retention dialog, proving actions are wired.
    fireEvent.click(screen.getByTestId('retention-btn'));
    expect(screen.getByTestId('retention-dialog')).toBeTruthy();
  });
});
