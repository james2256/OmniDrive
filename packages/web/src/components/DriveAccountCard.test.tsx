// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DriveAccountCard } from './DriveAccountCard';
import type { DriveAccount } from '../types';

// Mock ConfirmDialog as a passthrough that exposes its onConfirm/onClose via
// clickable buttons. DriveAccountCard renders ConfirmDialog internally for
// the disconnect flow; we want to simulate the user clicking the dialog's
// Confirm button to drive confirmDisconnect → onDisconnect(drive.id).
vi.mock('./ConfirmDialog', () => ({
  ConfirmDialog: ({ open, title, message, confirmText, onConfirm, onClose, loading }: any) =>
    open ? (
      <div data-testid="confirm-dialog">
        <div data-testid="confirm-title">{title}</div>
        <div data-testid="confirm-message">{message}</div>
        <button data-testid="confirm-confirm" onClick={onConfirm} disabled={loading}>
          {confirmText ?? 'Confirm'}
        </button>
        <button data-testid="confirm-cancel" onClick={onClose} disabled={loading}>
          Cancel
        </button>
      </div>
    ) : null,
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, type, ...props }: any) => (
    <button
      onClick={onClick}
      disabled={disabled}
      type={type}
      data-variant={variant}
      title={props.title}
      {...props}
    >
      {children}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  HardDrive: (props: any) => <svg data-testid="hard-drive-icon" {...props} />,
  RefreshCw: (props: any) => <svg data-testid="refresh-icon" {...props} />,
  Trash2: (props: any) => <svg data-testid="trash-icon" {...props} />,
}));

// QuotaBar is a pure presentational component — let it render for real so we
// can assert on its visual output (quota bar + label).
// lib/utils helpers (formatAbsoluteDate, formatFileSize, getDriveColor) are
// also pure — no mocking needed.

const baseDrive: DriveAccount = {
  id: 'drive-1',
  userId: 'u-1',
  googleAccountId: 'g-1',
  email: 'user@example.com',
  name: 'My Drive',
  type: 'oauth',
  isPrimary: false,
  rootFolderId: null,
  totalQuota: 100 * 1024 * 1024 * 1024, // 100 GiB
  usedQuota: 25 * 1024 * 1024 * 1024, // 25 GiB
  quotaOverride: null,
  freeSpace: 75 * 1024 * 1024 * 1024, // 75 GiB
  usagePercent: 25,
  hasLimit: true,
  syncStatus: 'idle',
  syncErrorMessage: null,
  syncPaused: false,
  health: 'connected',
  lastSyncedAt: '2024-01-01T00:00:00.000Z',
  quotaUpdatedAt: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('DriveAccountCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the drive email in the card body', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.getByText('user@example.com')).toBeTruthy();
  });

  it('renders the OAuth type label when drive.type is "oauth"', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.getByText('OAuth')).toBeTruthy();
  });

  it('renders the Service Account type label when drive.type is "service_account"', () => {
    const drive: DriveAccount = { ...baseDrive, type: 'service_account' };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByText('Service Account')).toBeTruthy();
  });

  it('renders the "Primary" label when drive.isPrimary is true', () => {
    const drive: DriveAccount = { ...baseDrive, isPrimary: true };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByText('· Primary')).toBeTruthy();
  });

  it('does NOT render the "Primary" label when drive.isPrimary is false', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.queryByText('· Primary')).toBeNull();
  });

  it('renders the Sync and Disconnect buttons', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: /Sync/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Disconnect/ })).toBeTruthy();
  });

  it('renders the quota bar (with used / total formatting) when hasLimit !== false', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    // The "X free of Y" label is rendered below the QuotaBar (always for
    // hasLimit !== false). formatFileSize renders with the configured unit.
    expect(screen.getByText(/free of/)).toBeTruthy();
    // usagePercent is 25 → "25.0%" is rendered next to the quota text.
    expect(screen.getByText('25.0%')).toBeTruthy();
  });

  it('renders the "Pooled storage" indicator (not a quota bar) when hasLimit is false', () => {
    const drive: DriveAccount = { ...baseDrive, hasLimit: false };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByText('Pooled storage')).toBeTruthy();
    expect(screen.queryByText(/free of/)).toBeNull();
  });

  it('clicking the Sync button calls onSync with drive.id', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    render(<DriveAccountCard drive={baseDrive} index={0} onSync={onSync} onDisconnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Sync/ }));
    await waitFor(() => {
      expect(onSync).toHaveBeenCalledWith('drive-1');
    });
  });

  it('clicking the Disconnect button opens the ConfirmDialog (calls setConfirmOpen(true))', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.queryByTestId('confirm-dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByTestId('confirm-title').textContent).toBe('Disconnect Drive');
  });

  it('confirming the disconnect dialog calls onDisconnect with drive.id', async () => {
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={onDisconnect} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();

    fireEvent.click(screen.getByTestId('confirm-confirm'));
    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledWith('drive-1');
    });
  });

  it('shows the disconnect message with email + the primary-drive warning when isPrimary', () => {
    const drive: DriveAccount = { ...baseDrive, isPrimary: true };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
    const message = screen.getByTestId('confirm-message').textContent ?? '';
    expect(message).toContain('Disconnect user@example.com?');
    expect(message).toContain('primary drive');
  });

  it('shows the disconnect message without the primary-drive warning when not primary', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/ }));
    const message = screen.getByTestId('confirm-message').textContent ?? '';
    expect(message).toContain('Disconnect user@example.com?');
    expect(message).not.toContain('primary drive');
  });

  it('disables the Sync button while drive.syncStatus is "syncing"', () => {
    const drive: DriveAccount = { ...baseDrive, syncStatus: 'syncing' };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Syncing/ }).hasAttribute('disabled')).toBe(true);
  });

  it('renders "syncing (paused)" badge during paused initial sync', () => {
    const drive: DriveAccount = {
      ...baseDrive,
      syncStatus: 'idle',
      syncPaused: true,
      lastSyncedAt: null,
    };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.getByText(/syncing \(paused\)/)).toBeTruthy();
  });

  it('does NOT render "syncing (paused)" badge when initial sync completed (lastSyncedAt set)', () => {
    const drive: DriveAccount = {
      ...baseDrive,
      syncStatus: 'idle',
      syncPaused: true,
      lastSyncedAt: '2026-08-09T16:05:00Z',
    };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.queryByText(/syncing \(paused\)/)).toBeNull();
  });

  it('renders the "Reconnect" button instead of Sync when needsReconnect (auth_expired + Token refresh)', () => {
    const drive: DriveAccount = {
      ...baseDrive,
      syncStatus: 'error',
      syncErrorMessage: 'Token refresh failed',
      health: 'auth_expired',
    };
    const onReconnect = vi.fn();
    render(
      <DriveAccountCard
        drive={drive}
        index={0}
        onSync={vi.fn()}
        onDisconnect={vi.fn()}
        onReconnect={onReconnect}
      />,
    );

    expect(screen.getByRole('button', { name: /Reconnect/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sync/ })).toBeNull();
  });

  it('clicking the Reconnect button calls onReconnect', () => {
    const drive: DriveAccount = {
      ...baseDrive,
      syncStatus: 'error',
      syncErrorMessage: 'Token refresh failed',
      health: 'auth_expired',
    };
    const onReconnect = vi.fn();
    render(
      <DriveAccountCard
        drive={drive}
        index={0}
        onSync={vi.fn()}
        onDisconnect={vi.fn()}
        onReconnect={onReconnect}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Reconnect/ }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('renders the "Last synced" date when drive.lastSyncedAt is set', () => {
    render(
      <DriveAccountCard drive={baseDrive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />,
    );

    expect(screen.getByText(/Last synced:/)).toBeTruthy();
  });

  it('does NOT render the "Last synced" date when drive.lastSyncedAt is null', () => {
    const drive: DriveAccount = { ...baseDrive, lastSyncedAt: null };
    render(<DriveAccountCard drive={drive} index={0} onSync={vi.fn()} onDisconnect={vi.fn()} />);

    expect(screen.queryByText(/Last synced:/)).toBeNull();
  });
});
