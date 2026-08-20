// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MoveDriveModal } from './MoveDriveModal';
import { useDrives } from '../hooks/useDrives';
import type { FileEntry, DriveAccount } from '../types';

// --- Hoisted mocks (so vi.mock factory closures can reference them) ---
const { addToast, moveMut } = vi.hoisted(() => ({
  addToast: vi.fn(),
  moveMut: { mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false },
}));

vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn() }));
vi.mock('../hooks/useFileMutations', () => ({
  useMoveFileToDrive: () => moveMut,
}));
vi.mock('../stores/useToastStore', () => ({
  useToastStore: (selector: any) => (selector ? selector({ addToast }) : { addToast }),
}));

vi.mock('lucide-react', () => ({
  HardDrive: (props: any) => <svg data-testid="hard-drive-icon" {...props} />,
  LoaderCircle: (props: any) => (
    <svg data-testid="loader-icon" className="animate-spin" {...props} />
  ),
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
  DialogHeader: ({ children, icon, subtitle }: any) => (
    <div>
      {icon}
      {children}
      {subtitle && <div data-testid="dialog-subtitle">{subtitle}</div>}
    </div>
  ),
  DialogBody: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children, title }: any) => <h2 title={title}>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

const drive1: DriveAccount = {
  id: 'drive-1',
  userId: 'user-1',
  googleAccountId: 'g1',
  email: 'source@bar.com',
  name: null,
  type: 'oauth',
  isPrimary: true,
  rootFolderId: null,
  totalQuota: 1024,
  usedQuota: 0,
  quotaOverride: null,
  freeSpace: 1024,
  usagePercent: 0,
  quotaUpdatedAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

const drive2: DriveAccount = {
  ...drive1,
  id: 'drive-2',
  email: 'dest@bar.com',
  isPrimary: false,
};

function makeFile(overrides: Partial<FileEntry> = {}): FileEntry {
  return {
    id: 'file-1',
    userId: 'user-1',
    driveAccountId: 'drive-1',
    googleFileId: 'g-file-1',
    workspaceId: null,
    workspaceFolderId: null,
    googleParentId: null,
    name: 'test.txt',
    mimeType: 'text/plain',
    size: 100,
    thumbnailUrl: null,
    webViewLink: null,
    webContentLink: null,
    isTrashed: false,
    googleCreatedAt: null,
    googleModifiedAt: null,
    syncedAt: '2024-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('MoveDriveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useDrives as Mock).mockReturnValue({
      data: { drives: [drive1, drive2], aggregate: { driveCount: 2 } },
    });
    moveMut.mutateAsync.mockResolvedValue(undefined);
    moveMut.mutate.mockResolvedValue(undefined);
    moveMut.isPending = false;
  });

  afterEach(() => cleanup());

  it('renders available drives excluding the source drive when a single file is selected', () => {
    const file = makeFile();
    render(<MoveDriveModal files={[file]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('Move to Another Drive')).toBeTruthy();
    expect(screen.getByText('dest@bar.com')).toBeTruthy();
    expect(screen.queryByText('source@bar.com')).toBeNull();
  });

  it('renders all drives when multiple files are selected (no exclusion)', () => {
    const fileA = makeFile({ id: 'f-a', driveAccountId: 'drive-1' });
    const fileB = makeFile({ id: 'f-b', driveAccountId: 'drive-2' });
    render(<MoveDriveModal files={[fileA, fileB]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByText('source@bar.com')).toBeTruthy();
    expect(screen.getByText('dest@bar.com')).toBeTruthy();
  });

  it('renders empty-state message when no other drives are available', () => {
    (useDrives as Mock).mockReturnValue({
      data: { drives: [drive1], aggregate: { driveCount: 1 } },
    });
    const file = makeFile();
    render(<MoveDriveModal files={[file]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(
      screen.getByText('No other drives available. Please connect another Google Drive account.'),
    ).toBeTruthy();
  });

  it('clicking a drive card triggers moveFileToDrive mutateAsync with file id and target drive id', async () => {
    const file = makeFile({ id: 'file-1' });
    render(<MoveDriveModal files={[file]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByText('dest@bar.com'));

    await waitFor(() => {
      expect(moveMut.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(moveMut.mutateAsync).toHaveBeenCalledWith({
      fileId: 'file-1',
      targetDriveId: 'drive-2',
    });
  });

  it('shows success toast and calls onSuccess after a successful move', async () => {
    const file = makeFile({ id: 'file-1' });
    const onSuccess = vi.fn();
    render(<MoveDriveModal files={[file]} onClose={vi.fn()} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByText('dest@bar.com'));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('success', 'Moved 1 item(s) to dest@bar.com');
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('shows error toast and calls onClose when the move fails', async () => {
    moveMut.mutateAsync.mockRejectedValue(new Error('boom'));
    const file = makeFile({ id: 'file-1' });
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    render(<MoveDriveModal files={[file]} onClose={onClose} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByText('dest@bar.com'));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Moved 0 item(s), 1 failed');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows info toast and calls onClose when the only file is already in the selected drive (multi-file path)', async () => {
    // For multi-file mode, all drives are shown (no exclusion).
    const fileA = makeFile({ id: 'f-a', driveAccountId: 'drive-1' });
    render(<MoveDriveModal files={[fileA]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    // For a single file, the source drive is excluded — to exercise the
    // "already in selected drive" branch we need multi-file mode where all
    // drives are shown. Use 2 files from the same drive.
    const fileB = makeFile({ id: 'f-b', driveAccountId: 'drive-1' });
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(<MoveDriveModal files={[fileA, fileB]} onClose={onClose} onSuccess={onSuccess} />);

    // Click the source drive — both files are already in it → continue skips them.
    fireEvent.click(screen.getByText('source@bar.com'));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('info', 'Items are already in the selected drive');
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    // No mutation actually fired because every file is in the source drive.
    expect(moveMut.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows loading spinner on the selected drive card while a move is in flight', async () => {
    moveMut.mutateAsync.mockReturnValue(new Promise(() => {})); // never resolves
    const file = makeFile({ id: 'file-1' });
    render(<MoveDriveModal files={[file]} onClose={vi.fn()} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByText('dest@bar.com'));

    expect(await screen.findByTestId('loader-icon')).toBeTruthy();
  });

  it('calls onClose when the dialog backdrop is clicked and no move is in flight', () => {
    const file = makeFile();
    const onClose = vi.fn();
    render(<MoveDriveModal files={[file]} onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByTestId('dialog-backdrop'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when backdrop is clicked while a move is in flight', async () => {
    moveMut.mutateAsync.mockReturnValue(new Promise(() => {})); // never resolves
    const file = makeFile();
    const onClose = vi.fn();
    render(<MoveDriveModal files={[file]} onClose={onClose} onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByText('dest@bar.com'));
    await screen.findByTestId('loader-icon');

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not render the dialog when no files are passed (files.length === 0)', () => {
    (useDrives as Mock).mockReturnValue({ data: undefined });
    render(<MoveDriveModal files={[]} onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });
});
