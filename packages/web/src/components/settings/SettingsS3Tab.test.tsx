// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SettingsS3Tab } from './SettingsS3Tab';
import { api } from '../../lib/api';
import { useToastStore } from '../../stores/useToastStore';

vi.mock('../../lib/api', () => ({
  api: {
    getS3Credentials: vi.fn(),
    createS3Credential: vi.fn(),
    deleteS3Credential: vi.fn(),
    getWorkspaces: vi.fn(),
  },
}));

vi.mock('../../stores/useToastStore', () => ({
  useToastStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  Plus: () => <svg data-testid="plus-icon" />,
  Trash2: () => <svg data-testid="trash-icon" />,
  Copy: () => <svg data-testid="copy-icon" />,
  Check: () => <svg data-testid="check-icon" />,
  TriangleAlert: () => <svg data-testid="alert-icon" />,
  LoaderCircle: () => <svg data-testid="loader-icon" className="animate-spin" />,
}));

vi.mock('../ui/dialog', () => ({
  Dialog: ({ open, children, onOpenChange }: any) =>
    open ? <div data-testid="dialog"><button data-testid="dialog-close" onClick={() => onOpenChange?.(false)} />{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

describe('SettingsS3Tab', () => {
  const addToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToastStore as unknown as Mock).mockReturnValue({ addToast });
    (api.getS3Credentials as Mock).mockResolvedValue([]);
    (api.getWorkspaces as Mock).mockResolvedValue({ workspaces: [] });
  });

  afterEach(() => cleanup());

  it('renders empty state when no S3 keys exist', async () => {
    render(<SettingsS3Tab />);

    expect(await screen.findByText('No S3 API keys generated yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate new key/i })).toBeTruthy();
  });

  it('renders S3 key table with correct columns and data', async () => {
    (api.getS3Credentials as Mock).mockResolvedValue([
      {
        id: 'k1',
        description: 'rclone laptop',
        access_key_id: 'OMNIABCDEF1234567890',
        workspace_id: null,
        created_at: '2026-01-15 10:30:00',
      },
      {
        id: 'k2',
        description: 'aws-cli scoped',
        access_key_id: 'OMNIXYZ0987654321',
        workspace_id: 'ws-1',
        workspace_name: 'Team Project',
        created_at: '2026-02-20 14:00:00',
      },
    ]);

    render(<SettingsS3Tab />);

    // Wait for table to render
    expect(await screen.findByText('rclone laptop')).toBeTruthy();
    expect(screen.getByText('aws-cli scoped')).toBeTruthy();
    expect(screen.getByText('OMNIABCDEF1234567890')).toBeTruthy();
    expect(screen.getByText('OMNIXYZ0987654321')).toBeTruthy();

    // Scope badges
    expect(screen.getByText('Global')).toBeTruthy();
    expect(screen.getByText('Workspace: Team Project')).toBeTruthy();

    // Table headers
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('Access Key ID')).toBeTruthy();
    expect(screen.getByText('Scope')).toBeTruthy();
    expect(screen.getByText('Created At')).toBeTruthy();
  });

  it('opens create key modal when Generate New Key clicked', async () => {
    render(<SettingsS3Tab />);

    fireEvent.click(await screen.findByRole('button', { name: /generate new key/i }));

    // Modal title renders as heading
    expect(screen.getByRole('heading', { name: /generate s3 api key/i })).toBeTruthy();
  });

  it('creates key and shows success toast on form submit', async () => {
    (api.createS3Credential as Mock).mockResolvedValue({
      id: 'k3',
      accessKeyId: 'OMNINEW1234567890',
      secretAccessKey: 'secret-key-value',
      description: 'test key',
    });

    render(<SettingsS3Tab />);

    fireEvent.click(await screen.findByRole('button', { name: /generate new key/i }));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Rclone desktop client/i), {
      target: { value: 'test key' },
    });

    fireEvent.click(screen.getByRole('button', { name: /generate key/i }));

    await waitFor(() => {
      expect(api.createS3Credential).toHaveBeenCalledWith('test key', undefined);
    });

    expect(addToast).toHaveBeenCalledWith('success', 'S3 API key created successfully');

    // Created credentials shown (access key + secret key displayed once)
    expect(await screen.findByText('OMNINEW1234567890')).toBeTruthy();
    expect(screen.getByText('secret-key-value')).toBeTruthy();
  });

  it('revokes key when trash button clicked', async () => {
    (api.getS3Credentials as Mock).mockResolvedValue([
      {
        id: 'k1',
        description: 'old key',
        access_key_id: 'OMNIOLD1234567890',
        workspace_id: null,
        created_at: '2026-01-15 10:30:00',
      },
    ]);
    (api.deleteS3Credential as Mock).mockResolvedValue({ success: true });

    // Mock window.confirm to auto-approve
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<SettingsS3Tab />);

    const trashBtn = await screen.findByTestId('trash-icon');
    fireEvent.click(trashBtn.closest('button')!);

    await waitFor(() => {
      expect(api.deleteS3Credential).toHaveBeenCalledWith('k1');
    });

    expect(addToast).toHaveBeenCalledWith('success', 'S3 key revoked successfully');
  });
});
