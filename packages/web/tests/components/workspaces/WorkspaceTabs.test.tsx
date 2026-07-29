// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceMembersTab } from '../../../src/components/workspaces/WorkspaceMembersTab';
import { WorkspaceSettingsTab } from '../../../src/components/workspaces/WorkspaceSettingsTab';
import { WorkspaceFilesTab } from '../../../src/components/workspaces/WorkspaceFilesTab';
import type { WorkspacePolicy } from '../../../src/types';

// Mock FileGrid to avoid complex dependencies
vi.mock('../../../src/components/files/FileGrid', () => ({
  FileGrid: () => <div data-testid="file-grid-mock">FileGrid Mock</div>,
}));

// Mock ConfirmDialog to expose onConfirm/onClose via clickable buttons so
// the parent's confirm-then-act flow is end-to-end testable without the
// real Radix Dialog portal.
vi.mock('../../../src/components/ConfirmDialog', () => ({
  ConfirmDialog: ({ open, onConfirm, onClose, loading }: any) =>
    open ? (
      <div data-testid="confirm-dialog">
        <button onClick={onConfirm} disabled={loading} data-testid="confirm-confirm">
          Delete
        </button>
        <button onClick={onClose} disabled={loading} data-testid="confirm-cancel">
          Cancel
        </button>
      </div>
    ) : null,
}));

// Mock the Button component to render a real <button> so fireEvent works
vi.mock('../../../src/components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, variant, className }: any) => (
    <button onClick={onClick} disabled={disabled} data-variant={variant} className={className}>
      {children}
    </button>
  ),
}));

// Mock workspacesApi — REQUIRED so the Settings tab doesn't try to fetch a
// relative URL (which fails in jsdom with "TypeError: Invalid URL").
// vi.hoisted ensures the mocks exist before the vi.mock factory runs
// (vi.mock is hoisted to the top of the file by Vitest).
const { mockGetWorkspacePolicies, mockCreateWorkspacePolicy, mockDeleteWorkspacePolicy } =
  vi.hoisted(() => ({
    mockGetWorkspacePolicies: vi.fn(),
    mockCreateWorkspacePolicy: vi.fn(),
    mockDeleteWorkspacePolicy: vi.fn(),
  }));

vi.mock('../../../src/lib/api/workspaces', () => ({
  workspacesApi: {
    getWorkspacePolicies: mockGetWorkspacePolicies,
    createWorkspacePolicy: mockCreateWorkspacePolicy,
    deleteWorkspacePolicy: mockDeleteWorkspacePolicy,
  },
}));

// Build a test policy — config is JSON string (matches the WorkspacePolicy type)
function makePolicy(overrides: Partial<WorkspacePolicy> = {}): WorkspacePolicy {
  return {
    id: 'policy-1',
    workspaceId: 'ws-1',
    targetType: 'workspace',
    targetId: null,
    policyType: 'storage_quota',
    config: JSON.stringify({ max_bytes: 5 * 1024 * 1024 * 1024 }),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Workspace Tab Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Members tab placeholder', () => {
    render(<WorkspaceMembersTab />);
    expect(screen.getByText('Members (Coming Soon)')).toBeDefined();
  });

  describe('WorkspaceSettingsTab', () => {
    it('renders Storage & Quota section heading', async () => {
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [] });
      render(<WorkspaceSettingsTab workspaceId="test-workspace-id" />);
      expect(screen.getByText('Storage & Quota')).toBeDefined();
      await waitFor(() => {
        expect(mockGetWorkspacePolicies).toHaveBeenCalledWith('test-workspace-id');
      });
    });

    it('shows "No governance policies active." when policies array is empty', async () => {
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await waitFor(() => {
        expect(screen.getByText('No governance policies active.')).toBeDefined();
      });
    });

    it('renders a storage_quota policy row with GB limit', async () => {
      const policy = makePolicy({
        policyType: 'storage_quota',
        config: JSON.stringify({ max_bytes: 10 * 1024 * 1024 * 1024 }),
      });
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [policy] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await waitFor(() => {
        expect(screen.getByText('storage quota')).toBeDefined();
      });
      expect(screen.getByText('10 GB limit')).toBeDefined();
    });

    it('renders a retention policy row with action + days', async () => {
      const policy = makePolicy({
        id: 'policy-retention',
        policyType: 'auto_delete',
        config: JSON.stringify({ action: 'delete', days: 30 }),
      });
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [policy] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await waitFor(() => {
        expect(screen.getByText('auto delete')).toBeDefined();
      });
      expect(screen.getByText('delete (30 days)')).toBeDefined();
    });

    it('shows "Remove Quota" button when a storage_quota policy exists', async () => {
      const policy = makePolicy({
        policyType: 'storage_quota',
        config: JSON.stringify({ max_bytes: 5 * 1024 * 1024 * 1024 }),
      });
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [policy] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await waitFor(() => {
        expect(screen.getByText('Quota:')).toBeDefined();
      });
      expect(screen.getByText('Remove Quota')).toBeDefined();
      expect(screen.getByText('5 GB')).toBeDefined();
    });

    it('shows "Set Quota" form (input + button) when no storage_quota policy exists', async () => {
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Limit in GB')).toBeDefined();
      });
      expect(screen.getByText('Set Quota')).toBeDefined();
    });

    it('calls createWorkspacePolicy when Set Quota is clicked with a value', async () => {
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [] });
      mockCreateWorkspacePolicy.mockResolvedValue({});
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      const input = await screen.findByPlaceholderText('Limit in GB');
      fireEvent.change(input, { target: { value: '15' } });
      fireEvent.click(screen.getByText('Set Quota'));
      await waitFor(() => {
        expect(mockCreateWorkspacePolicy).toHaveBeenCalledWith('ws-1', {
          targetType: 'workspace',
          policyType: 'storage_quota',
          config: { max_bytes: 15 * 1024 * 1024 * 1024 },
        });
      });
    });

    it('opens ConfirmDialog and deletes policy on confirm', async () => {
      const policy = makePolicy({
        policyType: 'storage_quota',
        config: JSON.stringify({ max_bytes: 5 * 1024 * 1024 * 1024 }),
      });
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [policy] });
      mockDeleteWorkspacePolicy.mockResolvedValue({});
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      // Wait for the policy to render, then click Remove Quota
      const removeButton = await screen.findByText('Remove Quota');
      fireEvent.click(removeButton);
      // ConfirmDialog opens
      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeDefined();
      });
      // Click confirm — should call deleteWorkspacePolicy
      fireEvent.click(screen.getByTestId('confirm-confirm'));
      await waitFor(() => {
        expect(mockDeleteWorkspacePolicy).toHaveBeenCalledWith('ws-1', 'policy-1');
      });
    });

    it('does NOT call createWorkspacePolicy when quota input is empty', async () => {
      mockGetWorkspacePolicies.mockResolvedValue({ policies: [] });
      render(<WorkspaceSettingsTab workspaceId="ws-1" />);
      await screen.findByPlaceholderText('Limit in GB');
      fireEvent.click(screen.getByText('Set Quota'));
      expect(mockCreateWorkspacePolicy).not.toHaveBeenCalled();
    });
  });

  describe('WorkspaceFilesTab', () => {
    it('renders Files tab with FileGrid mock', () => {
      const mockProps = {
        files: [],
        subfolders: [],
        getDriveInfo: vi.fn().mockReturnValue({ drive: {}, index: 0 }),
        onNavigateFolder: vi.fn(),
        onPreviewFile: vi.fn(),
        onShare: vi.fn(),
        onRenameFile: vi.fn(),
        onDeleteFile: vi.fn(),
        onMoveDrive: vi.fn(),
        isTargetShared: vi.fn(),
        errorDrives: new Set<string>(),
        onViewInfo: vi.fn(),
      };
      render(<WorkspaceFilesTab {...mockProps} />);
      expect(screen.getByTestId('file-grid-mock')).toBeDefined();
    });
  });
});
