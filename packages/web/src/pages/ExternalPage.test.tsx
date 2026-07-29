// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ExternalPage } from './ExternalPage';
import { useDrives } from '../hooks/useDrives';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';

// Stable mock refs.
const navigateMock = vi.hoisted(() => vi.fn());
const fetchNextPageMock = vi.hoisted(() => vi.fn());
const refetchInfiniteMock = vi.hoisted(() => vi.fn());
const refetchFolderMock = vi.hoisted(() => vi.fn());
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

vi.mock('react-router-dom', () => ({
  useParams: vi.fn(),
  useSearchParams: vi.fn(),
  useNavigate: () => navigateMock,
}));
vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn(), useGetDriveInfo: () => vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({
  useSharedLinks: vi.fn(() => ({ data: [] })),
  useIsTargetSharedCallback: () => vi.fn(),
}));
vi.mock('../hooks/useItemModals', () => ({ useItemModals: () => itemModals }));
vi.mock('../stores/useSelectionStore', () => ({
  useSelectionStore: vi.fn(() => ({
    selectedItems: [],
    clearSelection: vi.fn(),
    toggleSelection: vi.fn(),
  })),
  useClearSelectionOnRouteChange: vi.fn(),
}));
vi.mock('../stores/useUIStore', () => ({
  useUIStore: vi.fn(() => ({
    viewMode: 'list',
    setViewMode: vi.fn(),
    isInfoPanelOpen: false,
    toggleInfoPanel: vi.fn(),
  })),
}));
vi.mock('../stores/useToastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useInfiniteQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../lib/queryKeys', () => ({
  qk: {
    external: ['external'],
    externalFolder: (driveId: string, folderId: string) => ['externalFolder', driveId, folderId],
  },
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../components/files/FileGrid', () => ({
  FileGrid: ({ files, subfolders, actions }: any) => (
    <div data-testid="file-grid">
      {subfolders.map((f: any, idx: number) => (
        <button
          key={f.googleFolderId ?? f.id ?? `folder-${idx}`}
          data-testid={`folder-${f.googleFolderId ?? f.id}`}
          onClick={() =>
            actions.onNavigateFolder?.(
              f.googleFolderId ?? f.id,
              f.driveId ?? f.driveAccountId ?? 'd1',
            )
          }
        >
          {f.name}
        </button>
      ))}
      {files.map((f: any) => (
        <div key={f.id} data-testid={`file-${f.id}`}>
          <span>{f.name}</span>
          <button data-testid={`share-${f.id}`} onClick={() => actions.onShare?.(f.id, 'file')}>
            Share
          </button>
          <button data-testid={`preview-${f.id}`} onClick={() => actions.onPreviewFile?.(f)}>
            Preview
          </button>
          <button
            data-testid={`star-${f.id}`}
            onClick={() => actions.onToggleStar?.(f.id, 'file', f.isStarred)}
          >
            Star
          </button>
          <button
            data-testid={`delete-${f.id}`}
            onClick={() => actions.onDeleteFile?.(f.id, f.name)}
          >
            Delete
          </button>
          <button
            data-testid={`rename-${f.id}`}
            onClick={() => actions.onRenameFileRequest?.(f.id, f.name)}
          >
            Rename
          </button>
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../components/Breadcrumb', () => ({
  Breadcrumb: ({ items }: any) => (
    <nav data-testid="breadcrumb">
      {items.map((i: any, idx: number) => (
        <span key={i.id ?? `f-${idx}`}>{i.name}</span>
      ))}
    </nav>
  ),
}));

vi.mock('../components/layout/FilesToolbar', () => ({
  FilesToolbar: ({ searchQuery, setSearchQuery, breadcrumb }: any) => (
    <div data-testid="files-toolbar">
      <input
        data-testid="search-input"
        value={searchQuery}
        onChange={(e: any) => setSearchQuery(e.target.value)}
      />
      <div data-testid="breadcrumb-slot">{breadcrumb}</div>
    </div>
  ),
}));

vi.mock('../components/layout/BulkActionBar', () => ({ BulkActionBar: () => null }));
vi.mock('../components/files/ItemModals', () => ({ ItemModals: () => null }));

const topFile = {
  id: 'f1',
  name: 'top-file.pdf',
  mimeType: 'application/pdf',
  driveAccountId: 'd1',
};

const topFolder = {
  googleFolderId: 'gfolder-1',
  name: 'Top Folder',
  driveId: 'd1',
};

describe('ExternalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useParams as Mock).mockReturnValue({});
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams()]);
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'u@gmail.com' }] },
    });
    (useInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          {
            files: [topFile],
            folders: [topFolder],
            hasMore: false,
            nextCursor: null,
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: refetchFolderMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders loading state at top level while infinite query is loading', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders empty state when top-level infinite query has an error', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed'),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    // Error branch renders ErrorState with Retry button.
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders empty state when top-level returns no items', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: { pages: [{ files: [], folders: [], hasMore: false, nextCursor: null }] },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    expect(screen.getByText('No external items')).toBeTruthy();
  });

  it('renders top-level files and folders from infinite query', () => {
    render(<ExternalPage />);
    expect(screen.getByTestId('file-grid')).toBeTruthy();
    expect(screen.getByText('top-file.pdf')).toBeTruthy();
    expect(screen.getByText('Top Folder')).toBeTruthy();
  });

  it('shows Load More button when hasNextPage is true at top level', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          {
            files: [topFile],
            folders: [],
            hasMore: true,
            nextCursor: 'cursor-1',
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    expect(screen.getByText('Load More')).toBeTruthy();
  });

  it('calls fetchNextPage when Load More clicked', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          {
            files: [topFile],
            folders: [],
            hasMore: true,
            nextCursor: 'cursor-1',
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    fireEvent.click(screen.getByText('Load More'));
    expect(fetchNextPageMock).toHaveBeenCalledTimes(1);
  });

  it('renders Loading... text while fetching next page', () => {
    (useInfiniteQuery as Mock).mockReturnValue({
      data: {
        pages: [
          {
            files: [topFile],
            folders: [],
            hasMore: true,
            nextCursor: 'cursor-1',
          },
        ],
      },
      isLoading: false,
      error: null,
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage: fetchNextPageMock,
      refetch: refetchInfiniteMock,
    });
    render(<ExternalPage />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders folder drill-in contents when folderId and driveId are set', () => {
    (useParams as Mock).mockReturnValue({ folderId: 'folder-1' });
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?driveId=d1')]);
    (useQuery as Mock).mockReturnValue({
      data: {
        subfolders: [{ googleFolderId: 'sub-1', name: 'Sub Folder', driveId: 'd1' }],
        files: [{ id: 'f2', name: 'in-folder.pdf', mimeType: 'application/pdf' }],
        breadcrumb: [
          { id: 'root', name: 'My External Items' },
          { id: 'folder-1', name: 'Folder 1' },
        ],
      },
      isLoading: false,
      error: null,
      refetch: refetchFolderMock,
    });
    render(<ExternalPage />);
    expect(screen.getByText('in-folder.pdf')).toBeTruthy();
    expect(screen.getByText('Sub Folder')).toBeTruthy();
    expect(screen.getAllByText('My External Items').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Folder 1').length).toBeGreaterThan(0);
  });

  it('renders loading state at folder level while folder query is loading', () => {
    (useParams as Mock).mockReturnValue({ folderId: 'folder-1' });
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?driveId=d1')]);
    (useQuery as Mock).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: refetchFolderMock,
    });
    render(<ExternalPage />);
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders empty state when folder drill-in returns no items', () => {
    (useParams as Mock).mockReturnValue({ folderId: 'folder-1' });
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?driveId=d1')]);
    (useQuery as Mock).mockReturnValue({
      data: { subfolders: [], files: [], breadcrumb: [] },
      isLoading: false,
      error: null,
      refetch: refetchFolderMock,
    });
    render(<ExternalPage />);
    expect(screen.getByText('No external items')).toBeTruthy();
  });

  it('does not render Load More button at folder level', () => {
    (useParams as Mock).mockReturnValue({ folderId: 'folder-1' });
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?driveId=d1')]);
    (useQuery as Mock).mockReturnValue({
      data: {
        subfolders: [{ googleFolderId: 'sub-1', name: 'Sub Folder', driveId: 'd1' }],
        files: [{ id: 'f2', name: 'in-folder.pdf', mimeType: 'application/pdf' }],
        breadcrumb: [{ id: 'root', name: 'My External Items' }],
      },
      isLoading: false,
      error: null,
      refetch: refetchFolderMock,
    });
    render(<ExternalPage />);
    expect(screen.queryByText('Load More')).toBeNull();
  });

  it('navigates to external folder when folder clicked at top level', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('folder-gfolder-1'));
    expect(navigateMock).toHaveBeenCalledWith('/external/gfolder-1?driveId=d1');
  });

  it('navigates to nested external folder when subfolder clicked at folder level', () => {
    (useParams as Mock).mockReturnValue({ folderId: 'folder-1' });
    (useSearchParams as Mock).mockReturnValue([new URLSearchParams('?driveId=d1')]);
    (useQuery as Mock).mockReturnValue({
      data: {
        subfolders: [{ googleFolderId: 'sub-1', name: 'Sub Folder', driveId: 'd1' }],
        files: [],
        breadcrumb: [{ id: 'root', name: 'My External Items' }],
      },
      isLoading: false,
      error: null,
      refetch: refetchFolderMock,
    });
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('folder-sub-1'));
    expect(navigateMock).toHaveBeenCalledWith('/external/sub-1?driveId=d1');
  });

  it('triggers share action when share button clicked', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('share-f1'));
    expect(itemModals.setShareTarget).toHaveBeenCalledWith({ id: 'f1', type: 'file' });
  });

  it('triggers preview action when preview button clicked', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('preview-f1'));
    expect(itemModals.setPreviewFile).toHaveBeenCalled();
  });

  it('triggers toggle star action when star button clicked', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('star-f1'));
    expect(itemModals.toggleStar).toHaveBeenCalledWith('f1', 'file', undefined);
  });

  it('triggers rename action when rename button clicked', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('rename-f1'));
    expect(itemModals.handleRenameFileRequest).toHaveBeenCalledWith('f1', 'top-file.pdf');
  });

  it('triggers delete action when delete button clicked', () => {
    render(<ExternalPage />);
    fireEvent.click(screen.getByTestId('delete-f1'));
    expect(itemModals.handleDeleteFile).toHaveBeenCalledWith('f1', 'top-file.pdf');
  });

  it('filters files by search query in the toolbar', () => {
    render(<ExternalPage />);
    expect(screen.getByText('top-file.pdf')).toBeTruthy();
    fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'nope' } });
    // Search filter excludes the file — empty state shows.
    expect(screen.getByText('No external items')).toBeTruthy();
  });
});
