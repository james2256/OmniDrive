// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsDrivesTab } from './SettingsDrivesTab';
import { useDrives, useRemoveDrive, useTriggerSync } from '../../hooks/useDrives';
import { useToastStore } from '../../stores/useToastStore';
import { api } from '../../lib/api';

vi.mock('../../hooks/useDrives', () => ({
  useDrives: vi.fn(),
  useRemoveDrive: vi.fn(),
  useTriggerSync: vi.fn(),
}));

vi.mock('../../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  api: {
    getDriveConnectUrl: vi.fn(),
    addServiceAccount: vi.fn(),
  },
}));

vi.mock('../../lib/queryKeys', () => ({
  qk: { drives: ['drives'] },
}));

vi.mock('../DriveAccountCard', () => ({
  DriveAccountCard: ({ drive, onDisconnect }: any) => (
    <div data-testid={`drive-card-${drive.id}`}>
      <span>{drive.email}</span>
      <button data-testid={`disconnect-${drive.id}`} onClick={() => onDisconnect(drive.id)}>
        Disconnect
      </button>
    </div>
  ),
}));

vi.mock('lucide-react', () => ({
  Plus: () => <svg data-testid="plus-icon" />,
  Key: () => <svg data-testid="key-icon" />,
  X: () => <svg data-testid="x-icon" />,
  LoaderCircle: () => <svg data-testid="loader-icon" className="animate-spin" />,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    getQueryData: vi.fn().mockReturnValue({ drives: [] }),
  }),
}));

describe('SettingsDrivesTab', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
    (useRemoveDrive as Mock).mockReturnValue({ mutateAsync: vi.fn() });
    (useTriggerSync as Mock).mockReturnValue({ mutateAsync: vi.fn() });
  });

  afterEach(() => cleanup());

  it('renders empty state when no drives connected', () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [] } });

    render(<SettingsDrivesTab />);

    expect(screen.getByText('No drives connected yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add google drive/i })).toBeTruthy();
  });

  it('renders drive cards for connected drives', () => {
    (useDrives as Mock).mockReturnValue({
      data: {
        drives: [
          { id: 'd1', email: 'user1@gmail.com', type: 'oauth', isPrimary: true, syncStatus: 'idle', usedQuota: 0, totalQuota: 100, usagePercent: 0 },
          { id: 'd2', email: 'user2@gmail.com', type: 'service_account', isPrimary: false, syncStatus: 'idle', usedQuota: 50, totalQuota: 200, usagePercent: 25 },
        ],
      },
    });

    render(<SettingsDrivesTab />);

    expect(screen.getByText('user1@gmail.com')).toBeTruthy();
    expect(screen.getByText('user2@gmail.com')).toBeTruthy();
    expect(screen.getByTestId('drive-card-d1')).toBeTruthy();
    expect(screen.getByTestId('drive-card-d2')).toBeTruthy();
  });

  it('calls disconnect API when disconnect button clicked', async () => {
    const removeDriveMutation = vi.fn().mockResolvedValue(undefined);
    (useRemoveDrive as Mock).mockReturnValue({ mutateAsync: removeDriveMutation });
    (useDrives as Mock).mockReturnValue({
      data: { drives: [{ id: 'd1', email: 'user1@gmail.com', type: 'oauth', isPrimary: true, syncStatus: 'idle', usedQuota: 0, totalQuota: 100, usagePercent: 0 }] },
    });

    render(<SettingsDrivesTab />);

    fireEvent.click(screen.getByTestId('disconnect-d1'));

    await waitFor(() => {
      expect(removeDriveMutation).toHaveBeenCalledWith('d1');
    });
  });

  it('redirects to OAuth URL when Add Google Drive clicked', async () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [] } });
    (api.getDriveConnectUrl as Mock).mockResolvedValue({ url: 'https://accounts.google.com/auth' });

    // Mock window.location.href setter
    const originalLocation = window.location;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...originalLocation, set href(url: string) { hrefSetter(url); } },
    });

    render(<SettingsDrivesTab />);

    fireEvent.click(screen.getByRole('button', { name: /add google drive/i }));

    await waitFor(() => {
      expect(api.getDriveConnectUrl).toHaveBeenCalledTimes(1);
    });

    // Restore
    Object.defineProperty(window, 'location', { writable: true, value: originalLocation });
  });

  it('shows error toast when OAuth URL fetch fails', async () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [] } });
    (api.getDriveConnectUrl as Mock).mockRejectedValue(new Error('Network error'));

    render(<SettingsDrivesTab />);

    fireEvent.click(screen.getByRole('button', { name: /add google drive/i }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('error', 'Network error');
    });
  });
});
