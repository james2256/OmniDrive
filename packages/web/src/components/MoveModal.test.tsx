// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MoveModal } from './MoveModal';
import { drivesApi } from '../lib/api/drives';
import type { SelectedItem } from '../stores/useSelectionStore';

// --- Hoisted mocks (so vi.mock factory closures can reference them) ---
const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock('../lib/api/drives', () => ({
  drivesApi: {
    getDriveFolderContents: vi.fn(),
    moveToFolder: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: (selector: any) => (selector ? selector({ addToast }) : { addToast }),
}));

vi.mock('lucide-react', () => ({
  Folder: (props: any) => <svg data-testid="folder-icon" {...props} />,
  ChevronRight: (props: any) => <svg data-testid="chevron-right-icon" {...props} />,
  FolderInput: (props: any) => <svg data-testid="folder-input-icon" {...props} />,
}));

vi.mock('./ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? (
      <div data-testid="dialog">
        <button data-testid="dialog-backdrop" onClick={() => onOpenChange?.(false)} />
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children, icon }: any) => (
    <div>
      {icon}
      {children}
    </div>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, loading, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled || loading} type={type} {...props}>
      {loading && <span data-testid="button-spinner" />}
      {children}
    </button>
  ),
}));

describe('MoveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (drivesApi.getDriveFolderContents as Mock).mockResolvedValue({
      subfolders: [
        { googleFolderId: 'sub-1', name: 'SubFolder A' },
        { googleFolderId: 'sub-2', name: 'SubFolder B' },
      ],
      breadcrumb: [{ id: 'root', name: 'My Drive' }],
    });
    (drivesApi.moveToFolder as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  const fileItem: SelectedItem = {
    type: 'file',
    item: {
      id: 'file-1',
      googleParentId: 'parent-1',
    } as any,
  };

  it('renders the folder tree (breadcrumb + subfolders) when open', async () => {
    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(screen.getByText('Move 1 item')).toBeTruthy();
    expect(await screen.findByText('SubFolder A')).toBeTruthy();
    expect(screen.getByText('SubFolder B')).toBeTruthy();
    expect(screen.getByText('My Drive')).toBeTruthy();
    expect(drivesApi.getDriveFolderContents).toHaveBeenCalledWith('drive-1', 'root');
  });

  it('renders "No subfolders here" when folder has no subfolders', async () => {
    (drivesApi.getDriveFolderContents as Mock).mockResolvedValue({
      subfolders: [],
      breadcrumb: [{ id: 'root', name: 'My Drive' }],
    });

    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    expect(await screen.findByText('No subfolders here')).toBeTruthy();
  });

  it('selecting a folder navigates into it (updates breadcrumb + refetches)', async () => {
    let callCount = 0;
    (drivesApi.getDriveFolderContents as Mock).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          subfolders: [{ googleFolderId: 'sub-1', name: 'SubFolder A' }],
          breadcrumb: [{ id: 'root', name: 'My Drive' }],
        };
      }
      return {
        subfolders: [{ googleFolderId: 'sub-2', name: 'Nested B' }],
        breadcrumb: [
          { id: 'root', name: 'My Drive' },
          { id: 'sub-1', name: 'SubFolder A' },
        ],
      };
    });

    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    fireEvent.click(await screen.findByText('SubFolder A'));

    await waitFor(() => {
      expect(drivesApi.getDriveFolderContents).toHaveBeenNthCalledWith(2, 'drive-1', 'sub-1');
    });
    expect(await screen.findByText('Nested B')).toBeTruthy();
    // Breadcrumb shows parent as a clickable link
    expect(screen.getByText('SubFolder A')).toBeTruthy();
  });

  it('clicking "Move here" calls drivesApi.moveToFolder with correct args for file items', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveModal
        open
        items={[fileItem]}
        driveId="drive-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await screen.findByText('SubFolder A');

    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() => {
      expect(drivesApi.moveToFolder).toHaveBeenCalledTimes(1);
    });
    expect(drivesApi.moveToFolder).toHaveBeenCalledWith(
      'drive-1',
      'file-1',
      'root',
      'parent-1',
      false,
    );
  });

  it('clicking "Move here" calls drivesApi.moveToFolder with isFolder=true for folder items', async () => {
    const folderItem: SelectedItem = {
      type: 'folder',
      item: {
        googleFolderId: 'g-folder-1',
        googleParentId: 'parent-1',
      } as any,
    };

    render(
      <MoveModal
        open
        items={[folderItem]}
        driveId="drive-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await screen.findByText('SubFolder A');

    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() => {
      expect(drivesApi.moveToFolder).toHaveBeenCalledTimes(1);
    });
    expect(drivesApi.moveToFolder).toHaveBeenCalledWith(
      'drive-1',
      'g-folder-1',
      'root',
      'parent-1',
      true,
    );
  });

  it('shows success toast and calls onSuccess + onClose when all moves succeed', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveModal
        open
        items={[fileItem]}
        driveId="drive-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    await screen.findByText('SubFolder A');
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('success', 'Moved 1 item');
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows error toast with mixed-success message when some moves fail', async () => {
    (drivesApi.moveToFolder as Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('cannot move'));

    const fileA: SelectedItem = {
      type: 'file',
      item: { id: 'f-a', googleParentId: null } as any,
    };
    const fileB: SelectedItem = {
      type: 'file',
      item: { id: 'f-b', googleParentId: null } as any,
    };

    render(
      <MoveModal
        open
        items={[fileA, fileB]}
        driveId="drive-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(await screen.findByText('Move 2 items')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Moved 1 item, 1 failed');
    });
  });

  it('shows "Moving..." and disables buttons while a move is in flight', async () => {
    (drivesApi.moveToFolder as Mock).mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={vi.fn()} onSuccess={vi.fn()} />,
    );

    await screen.findByText('SubFolder A');
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

    expect(await screen.findByText('Moving...')).toBeTruthy();
    // Cancel disabled while moving
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });

  it('Cancel button calls onClose when not moving', async () => {
    const onClose = vi.fn();
    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={onClose} onSuccess={vi.fn()} />,
    );

    await screen.findByText('SubFolder A');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking dialog backdrop triggers onClose when not moving', async () => {
    const onClose = vi.fn();
    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={onClose} onSuccess={vi.fn()} />,
    );

    await screen.findByText('SubFolder A');
    fireEvent.click(screen.getByTestId('dialog-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when backdrop is clicked while a move is in flight', async () => {
    (drivesApi.moveToFolder as Mock).mockReturnValue(new Promise(() => {})); // never resolves

    const onClose = vi.fn();
    render(
      <MoveModal open items={[fileItem]} driveId="drive-1" onClose={onClose} onSuccess={vi.fn()} />,
    );

    await screen.findByText('SubFolder A');
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await screen.findByText('Moving...');

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
