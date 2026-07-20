import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkspaceMainView } from '../../../src/components/workspaces/WorkspaceMainView';

vi.mock('../../../src/components/workspaces/WorkspaceFilesTab', () => ({
  WorkspaceFilesTab: () => <div data-testid="files-tab">Files Tab Content</div>
}));
vi.mock('../../../src/components/workspaces/WorkspaceMembersTab', () => ({
  WorkspaceMembersTab: () => <div data-testid="members-tab">Members Tab Content</div>
}));
vi.mock('../../../src/components/workspaces/WorkspaceSettingsTab', () => ({
  WorkspaceSettingsTab: () => <div data-testid="settings-tab">Settings Tab Content</div>
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  );
}

describe('WorkspaceMainView', () => {
  const mockProps = {
    activeFolder: { id: '1', name: 'Engineering', workspaceId: 'w1', parentId: null, icon: null, color: null, isStarred: false, createdAt: '', updatedAt: '' },
    path: [{ id: '1', name: 'Engineering' }],
    onCreateFolder: vi.fn(),
    onSync: vi.fn(),
    isSyncing: false,
    fileTabProps: {
      files: [], subfolders: [], getDriveInfo: vi.fn(), onNavigateFolder: vi.fn(),
      onPreviewFile: vi.fn(), onShare: vi.fn(), onRenameFile: vi.fn(), onDeleteFile: vi.fn(),
      onMoveDrive: vi.fn(), isTargetShared: vi.fn(), errorDrives: new Set<string>(), onViewInfo: vi.fn(),
      actions: { onToggleStar: vi.fn(), onPreviewFile: vi.fn() }
    }
  };

  it('renders breadcrumbs and title', () => {
    renderWithProviders(<WorkspaceMainView {...mockProps} />);
    expect(screen.getAllByText('Engineering')).toBeDefined();
    expect(screen.getByRole('heading', { level: 1, name: 'Engineering' })).toBeDefined();
  });

  it('switches tabs correctly', () => {
    renderWithProviders(<WorkspaceMainView {...mockProps} />);
    expect(screen.getAllByTestId('files-tab').length).toBeGreaterThan(0);

    const memberTabs = screen.getAllByText('Members');
    fireEvent.click(memberTabs[0]);
    expect(screen.getAllByTestId('members-tab').length).toBeGreaterThan(0);

    const settingsTabs = screen.getAllByText('Settings');
    fireEvent.click(settingsTabs[0]);
    expect(screen.getAllByTestId('settings-tab').length).toBeGreaterThan(0);
  });
});
