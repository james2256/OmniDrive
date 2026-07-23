// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ShareModal } from './ShareModal';
import { createSharedLink } from '../lib/api';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';

vi.mock('../lib/api', () => ({
  createSharedLink: vi.fn(),
}));

vi.mock('../hooks/useSharedLinks', () => ({
  useInvalidateSharedLinks: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  Share2: () => <svg data-testid="share-icon" />,
  Calendar: () => <svg data-testid="calendar-icon" />,
  Lock: () => <svg data-testid="lock-icon" />,
  Settings: () => <svg data-testid="settings-icon" />,
  ChevronDown: () => <svg data-testid="chevron-down-icon" />,
  ChevronUp: () => <svg data-testid="chevron-up-icon" />,
  Eye: () => <svg data-testid="eye-icon" />,
  EyeOff: () => <svg data-testid="eye-off-icon" />,
}));

vi.mock('./ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? <div data-testid="dialog"><button data-testid="dialog-backdrop" onClick={() => onOpenChange?.(false)} />{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

describe('ShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useInvalidateSharedLinks as Mock).mockReturnValue(vi.fn());
  });

  afterEach(() => cleanup());

  it('submits form with correct payload and displays generated URL', async () => {
    (createSharedLink as Mock).mockResolvedValue({ url: 'https://example.com/s/abc123' });

    render(
      <ShareModal open targetType="file" targetId="file-1" onClose={vi.fn()} />
    );

    // Fill password
    fireEvent.change(screen.getByPlaceholderText('Leave blank for no password'), {
      target: { value: 'secret123' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Create Link' }));

    await waitFor(() => {
      expect(createSharedLink).toHaveBeenCalledTimes(1);
    });

    const callArg = (createSharedLink as Mock).mock.calls[0][0];
    expect(callArg).toMatchObject({
      targetType: 'file',
      targetId: 'file-1',
      password: 'secret123',
      allowDownloads: true,
      maxDownloads: null,
      requireEmail: false,
    });

    // URL input appears after success
    expect(await screen.findByDisplayValue('https://example.com/s/abc123')).toBeTruthy();
  });

  it('displays error message when API call fails', async () => {
    (createSharedLink as Mock).mockRejectedValue(new Error('Rate limit exceeded'));

    render(
      <ShareModal open targetType="folder" targetId="folder-1" onClose={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Link' }));

    expect(await screen.findByText('Rate limit exceeded')).toBeTruthy();
    // Form stays visible (no URL input)
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('shows copy button and toggles to check icon after copying', async () => {
    (createSharedLink as Mock).mockResolvedValue({ url: 'https://example.com/s/xyz' });

    render(
      <ShareModal open targetType="file" targetId="file-1" onClose={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Link' }));

    // Wait for URL to appear
    await screen.findByDisplayValue('https://example.com/s/xyz');

    const copyBtn = screen.getByTitle('Copy to clipboard');
    expect(screen.getByTestId('copy-icon')).toBeTruthy();

    // Mock clipboard
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(screen.getByTestId('check-icon')).toBeTruthy();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/s/xyz');
  });

  it('sends advanced settings when expanded and filled', async () => {
    (createSharedLink as Mock).mockResolvedValue({ url: 'https://example.com/s/adv' });

    render(
      <ShareModal open targetType="file" targetId="file-1" onClose={vi.fn()} />
    );

    // Expand advanced
    fireEvent.click(screen.getByText('Advanced'));

    // Toggle "Require Email"
    fireEvent.click(screen.getByText('Require email to view'));

    // Set max downloads
    fireEvent.change(screen.getByPlaceholderText('Max downloads (blank = unlimited)'), {
      target: { value: '5' },
    });

    // Uncheck "Allow Downloads" (checked by default)
    fireEvent.click(screen.getByText('Allow downloads'));

    fireEvent.click(screen.getByRole('button', { name: 'Create Link' }));

    await waitFor(() => {
      expect(createSharedLink).toHaveBeenCalledTimes(1);
    });

    const callArg = (createSharedLink as Mock).mock.calls[0][0];
    expect(callArg).toMatchObject({
      allowDownloads: false,
      requireEmail: true,
      maxDownloads: 5,
    });
  });
});
