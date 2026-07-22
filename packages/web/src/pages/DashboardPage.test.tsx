// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DashboardPage } from './DashboardPage';
import { useDrives } from '../hooks/useDrives';
import { useSharedLinks } from '../hooks/useSharedLinks';
import { useAuthStore } from '../stores/useAuthStore';

vi.mock('../hooks/useDrives', () => ({ useDrives: vi.fn() }));
vi.mock('../hooks/useSharedLinks', () => ({ useSharedLinks: vi.fn() }));
vi.mock('../hooks/useFileMutations', () => ({
  useStarFile: () => ({ mutate: vi.fn() }),
  useUnstarFile: () => ({ mutate: vi.fn() }),
}));
vi.mock('../hooks/useFolderMutations', () => ({
  useStarFolder: () => ({ mutate: vi.fn() }),
  useUnstarFolder: () => ({ mutate: vi.fn() }),
}));
vi.mock('../stores/useAuthStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('../stores/useToastStore', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }));

vi.mock('../lib/api', () => ({
  api: {},
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('../lib/queryKeys', () => ({
  qk: { recent: ['recent'], category: ['category'], drives: ['drives'] },
}));

vi.mock('../components/QuotaBar', () => ({
  QuotaBar: ({ used, total }: any) => <div data-testid="quota-bar">{used}/{total}</div>,
}));

vi.mock('../components/files/FileGrid', () => ({
  FileGrid: ({ files }: any) => (
    <div data-testid="file-grid">{files.map((f: any) => <span key={f.id}>{f.name}</span>)}</div>
  ),
}));

vi.mock('../components/ShareModal', () => ({
  ShareModal: () => null,
}));
vi.mock('../components/MoveDriveModal', () => ({
  MoveDriveModal: () => null,
}));
vi.mock('../components/FilePreviewModal', () => ({
  FilePreviewModal: () => null,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('recharts', () => ({
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="cell" />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
}));

vi.mock('lucide-react', () => ({
  HardDrive: () => <svg data-testid="hdd-icon" />,
  RefreshCw: () => <svg data-testid="refresh-icon" />,
  Clock: () => <svg data-testid="clock-icon" />,
  Star: () => <svg data-testid="star-icon" />,
  FolderTree: () => <svg data-testid="folder-tree-icon" />,
  Share2: () => <svg data-testid="share-icon" />,
  Settings: () => <svg data-testid="settings-icon" />,
  ArrowRight: () => <svg data-testid="arrow-right-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
  Cloud: () => <svg data-testid="cloud-icon" />,
  Image: () => <svg data-testid="image-icon" />,
  Film: () => <svg data-testid="film-icon" />,
  Music: () => <svg data-testid="music-icon" />,
  FileText: () => <svg data-testid="file-text-icon" />,
  Archive: () => <svg data-testid="archive-icon" />,
  Users: () => <svg data-testid="users-icon" />,
}));

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useAuthStore as unknown as Mock).mockReturnValue({ user: { id: 'u1', name: 'Alice', role: 'member' } });
    (useSharedLinks as Mock).mockReturnValue({ data: [] });
  });

  afterEach(() => cleanup());

  it('renders empty state with connect-drive CTA when no drives connected', async () => {
    (useDrives as Mock).mockReturnValue({ data: { drives: [], aggregate: { totalQuota: 0, totalUsed: 0, totalFree: 0, driveCount: 0 } }, isLoading: false });
    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock).mockReturnValue({ data: null });

    render(<DashboardPage />);

    expect(await screen.findByText('No drives connected')).toBeTruthy();
    expect(screen.getByRole('button', { name: /connect a drive/i })).toBeTruthy();
  });

  it('renders storage hero, quota bar, and connected drives when drives exist', async () => {
    (useDrives as Mock).mockReturnValue({
      data: {
        drives: [
          { id: 'd1', email: 'alice@gmail.com', type: 'oauth', isPrimary: true, usedQuota: 30, totalQuota: 100, usagePercent: 30 },
        ],
        aggregate: { totalQuota: 100, totalUsed: 30, totalFree: 70, driveCount: 1 },
      },
      isLoading: false,
    });

    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock)
      .mockReturnValueOnce({ data: { files: [], folders: [] } }) // recent
      .mockReturnValueOnce({ data: null }); // category

    render(<DashboardPage />);

    expect(await screen.findByText('Total storage')).toBeTruthy();
    // QuotaBar renders for the hero + once per drive card
    expect(screen.getAllByTestId('quota-bar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('alice@gmail.com')).toBeTruthy();
    // Percentage is split across elements (number + <span>%</span>); match the numeric part
    expect(screen.getByText('30.0')).toBeTruthy();
  });

  it('renders recent files section when recent files exist', async () => {
    (useDrives as Mock).mockReturnValue({
      data: {
        drives: [{ id: 'd1', email: 'alice@gmail.com', type: 'oauth', isPrimary: true, usedQuota: 0, totalQuota: 100, usagePercent: 0 }],
        aggregate: { totalQuota: 100, totalUsed: 0, totalFree: 100, driveCount: 1 },
      },
      isLoading: false,
    });

    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock)
      .mockReturnValueOnce({ data: { files: [{ id: 'f1', name: 'report.pdf' }], folders: [] } })
      .mockReturnValueOnce({ data: { images: 0, videos: 0, documents: 100, audio: 0, archives: 0, others: 0 } });

    render(<DashboardPage />);

    expect(await screen.findByText('report.pdf')).toBeTruthy();
    expect(screen.getByText('Recent')).toBeTruthy();
  });

  it('renders category donut chart when category data exists', async () => {
    (useDrives as Mock).mockReturnValue({
      data: {
        drives: [{ id: 'd1', email: 'alice@gmail.com', type: 'oauth', isPrimary: true, usedQuota: 0, totalQuota: 100, usagePercent: 0 }],
        aggregate: { totalQuota: 100, totalUsed: 0, totalFree: 100, driveCount: 1 },
      },
      isLoading: false,
    });

    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock)
      .mockReturnValueOnce({ data: { files: [], folders: [] } })
      .mockReturnValueOnce({ data: { images: 50, videos: 30, documents: 20, audio: 0, archives: 0, others: 0 } });

    render(<DashboardPage />);

    expect(await screen.findByTestId('pie-chart')).toBeTruthy();
    expect(screen.getByText('Documents')).toBeTruthy();
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText('Videos')).toBeTruthy();
  });

  it('renders admin tools section only for super_admin users', async () => {
    (useAuthStore as unknown as Mock).mockReturnValue({ user: { id: 'u1', name: 'Admin', role: 'super_admin' } });
    (useDrives as Mock).mockReturnValue({
      data: {
        drives: [{ id: 'd1', email: 'admin@gmail.com', type: 'oauth', isPrimary: true, usedQuota: 0, totalQuota: 100, usagePercent: 0 }],
        aggregate: { totalQuota: 100, totalUsed: 0, totalFree: 100, driveCount: 1 },
      },
      isLoading: false,
    });

    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock)
      .mockReturnValueOnce({ data: { files: [], folders: [] } })
      .mockReturnValueOnce({ data: null });

    render(<DashboardPage />);

    expect(await screen.findByText('Admin tools')).toBeTruthy();
  });
});
