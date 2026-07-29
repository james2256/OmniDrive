// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CreateFolderModal } from './CreateFolderModal';
import { drivesApi } from '../lib/api/drives';
import { foldersApi } from '../lib/api/folders';
import type { DriveAccount } from '../types';

// --- Hoisted mocks ---
const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock('../lib/api/drives', () => ({
  drivesApi: {
    createDriveFolder: vi.fn(),
  },
}));

vi.mock('../lib/api/folders', () => ({
  foldersApi: {
    createFolder: vi.fn(),
  },
}));

vi.mock('../stores/useToastStore', () => ({
  useToastStore: (selector: any) => (selector ? selector({ addToast }) : { addToast }),
}));

vi.mock('lucide-react', () => ({
  FolderPlus: (props: any) => <svg data-testid="folder-plus-icon" {...props} />,
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
  Button: ({ children, onClick, disabled, loading, type, variant: _variant, ...props }: any) => (
    <button onClick={onClick} disabled={disabled || loading} type={type} {...props}>
      {loading && <span data-testid="button-spinner" />}
      {children}
    </button>
  ),
}));

vi.mock('./ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

const drive1: DriveAccount = {
  id: 'drive-1',
  userId: 'user-1',
  googleAccountId: 'g1',
  email: 'one@bar.com',
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
  email: 'two@bar.com',
  isPrimary: false,
};

describe('CreateFolderModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (drivesApi.createDriveFolder as Mock).mockResolvedValue({ googleFolderId: 'g-new' });
    (foldersApi.createFolder as Mock).mockResolvedValue({
      folder: { id: 'ws-new', name: 'Foo' },
    });
  });

  afterEach(() => cleanup());

  it('renders the form (title, name input, Cancel, Create) when open', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('New Folder')).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter folder name')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('shows validation error when submitting with an empty name', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Folder name is required')).toBeTruthy();
    expect(drivesApi.createDriveFolder).not.toHaveBeenCalled();
    expect(foldersApi.createFolder).not.toHaveBeenCalled();
  });

  it('trims whitespace before validating name', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(screen.getByText('Folder name is required')).toBeTruthy();
  });

  it('renders drive picker when driveId is omitted and more than one drive exists', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        drives={[drive1, drive2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Target Drive')).toBeTruthy();
    // Default option plus two drive options
    expect(screen.getByText('Select a drive…')).toBeTruthy();
    expect(screen.getByText('one@bar.com (1)')).toBeTruthy();
    expect(screen.getByText('two@bar.com (2)')).toBeTruthy();
  });

  it('does not render drive picker when driveId is provided', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        driveId="drive-1"
        drives={[drive1, drive2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByText('Target Drive')).toBeNull();
  });

  it('disables Create button when drive picker is shown and no drive is selected', () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        drives={[drive1, drive2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const createBtn = screen.getByRole('button', { name: 'Create' });
    expect(createBtn).toHaveProperty('disabled', true);
  });

  it('submit creates a Google Drive folder via drivesApi when driveId is set', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateFolderModal
        open
        parentId="parent-g"
        title="New Folder"
        driveId="drive-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'My Sub' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(drivesApi.createDriveFolder).toHaveBeenCalledWith('drive-1', 'My Sub', 'parent-g');
    });
    expect(foldersApi.createFolder).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('success', 'Folder created successfully');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submit calls drivesApi when driveId is omitted but exactly one drive is provided (auto-selected)', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        drives={[drive1]}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'Workspace Sub' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Source auto-selects the single drive → drivesApi.createDriveFolder is used.
    await waitFor(() => {
      expect(drivesApi.createDriveFolder).toHaveBeenCalledWith(
        'drive-1',
        'Workspace Sub',
        undefined,
      );
    });
    expect(foldersApi.createFolder).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith('success', 'Folder created successfully');
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submit creates a workspace folder when no driveId and no drives prop', async () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'No Drive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(foldersApi.createFolder).toHaveBeenCalledWith('No Drive', undefined);
    });
    expect(drivesApi.createDriveFolder).not.toHaveBeenCalled();
  });

  it('shows error message when API call rejects and does NOT call addToast', async () => {
    (drivesApi.createDriveFolder as Mock).mockRejectedValue(new Error('Quota exceeded'));

    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Workspace"
        driveId="drive-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter workspace name'), {
      target: { value: 'Boom' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Quota exceeded')).toBeTruthy();
    // Source only calls setError on catch — no error toast is emitted.
    expect(addToast).not.toHaveBeenCalled();
  });

  it('shows generic error message when the thrown value is not an Error instance', async () => {
    // A non-Error rejection falls through to the `Failed to create <entity>` branch.
    (foldersApi.createFolder as Mock).mockRejectedValue('unexpected string');

    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'Boom' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Failed to create folder')).toBeTruthy();
  });

  it('shows loading state on the Create button while the API call is in flight', async () => {
    (drivesApi.createDriveFolder as Mock).mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        driveId="drive-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'Slow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // Spinner appears next to the Create button text; button label stays 'Create'.
    expect(await screen.findByTestId('button-spinner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);
    // Cancel disabled while loading
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
  });

  it('Cancel button calls onClose when not loading', () => {
    const onClose = vi.fn();
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        driveId="drive-1"
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('dialog backdrop triggers onClose when not loading', () => {
    const onClose = vi.fn();
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        driveId="drive-1"
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('selecting a drive from the picker enables the Create button', async () => {
    render(
      <CreateFolderModal
        open
        parentId={null}
        title="New Folder"
        drives={[drive1, drive2]}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Initially disabled (no drive selected)
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'drive-1' } });

    // After selecting, button enabled
    expect(screen.getByRole('button', { name: 'Create' })).toHaveProperty('disabled', false);
  });

  it('passes parentId to createDriveFolder when provided', async () => {
    render(
      <CreateFolderModal
        open
        parentId="parent-x"
        title="New Folder"
        driveId="drive-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter folder name'), {
      target: { value: 'Child' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(drivesApi.createDriveFolder).toHaveBeenCalledWith('drive-1', 'Child', 'parent-x');
    });
  });
});
