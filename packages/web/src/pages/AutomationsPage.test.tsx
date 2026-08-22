// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AutomationsPage } from './AutomationsPage';

// Stable mock refs — hoisted so the vi.mock factory can reference them.
const useAutomationsMock = vi.hoisted(() => vi.fn());
const useToggleAutomationMock = vi.hoisted(() => vi.fn());
const useDeleteAutomationMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useAutomations', () => ({
  useAutomations: useAutomationsMock,
  useToggleAutomation: useToggleAutomationMock,
  useDeleteAutomation: useDeleteAutomationMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({ data: undefined })),
}));

// Modals are tested independently — stub them so page tests focus on the list.
vi.mock('../components/automation/CreateAutomationModal', () => ({
  CreateAutomationModal: ({ open, editingRule }: { open: boolean; editingRule: unknown }) =>
    open ? <div data-testid="create-modal">editing:{editingRule ? 'yes' : 'no'}</div> : null,
}));
vi.mock('../components/automation/AutomationLogsModal', () => ({
  AutomationLogsModal: ({ ruleId }: { ruleId: string | null }) =>
    ruleId ? <div data-testid="logs-modal">{ruleId}</div> : null,
}));
vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: ({
    open,
    onConfirm,
    message,
  }: {
    open: boolean;
    onConfirm: () => void;
    message: string;
  }) =>
    open ? (
      <div data-testid="confirm-dialog">
        <span>{message}</span>
        <button data-testid="confirm-btn" onClick={onConfirm}>
          Delete
        </button>
      </div>
    ) : null,
}));
vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));
vi.mock('../components/EmptyState', () => ({
  EmptyState: ({ title }: any) => <div data-testid="empty-state">{title}</div>,
  ListSkeleton: () => <div data-testid="skeleton">Loading...</div>,
}));
vi.mock('../components/ErrorState', () => ({
  ErrorState: ({ onRetry }: any) => (
    <div data-testid="error-state">
      <button data-testid="retry-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  ),
}));
vi.mock('lucide-react', () => ({
  Zap: () => <svg data-testid="zap-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
  Pencil: () => <svg data-testid="pencil-icon" />,
  Trash2: () => <svg data-testid="trash-icon" />,
  ScrollText: () => <svg data-testid="scroll-icon" />,
}));

const toggleMutate = vi.fn();
const deleteMutate = vi.fn();
const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);

function mockHookReturn(
  overrides: Partial<{
    data: unknown[];
    isLoading: boolean;
    error: unknown;
    refetch: () => void;
  }> = {},
) {
  return {
    data: [],
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('AutomationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationsMock.mockReturnValue(mockHookReturn());
    useToggleAutomationMock.mockReturnValue({ mutate: toggleMutate, isPending: false });
    useDeleteAutomationMock.mockReturnValue({
      mutate: deleteMutate,
      mutateAsync: deleteMutateAsync,
      isPending: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders page title "Automation Rules"', () => {
    render(<AutomationsPage />);
    expect(screen.getByText('Automation Rules')).toBeTruthy();
  });

  it('renders loading skeleton while isLoading is true', () => {
    useAutomationsMock.mockReturnValue(mockHookReturn({ isLoading: true }));
    render(<AutomationsPage />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders empty state when there are no rules', () => {
    render(<AutomationsPage />);
    expect(screen.getByTestId('empty-state')).toBeTruthy();
  });

  it('renders error state with retry when fetch fails', () => {
    const refetch = vi.fn();
    useAutomationsMock.mockReturnValue(mockHookReturn({ error: new Error('boom'), refetch }));
    render(<AutomationsPage />);
    expect(screen.getByTestId('error-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('retry-btn'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a list of rules with name, trigger, conditions, and toggle button', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Auto-archive PDFs',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [{ field: 'extension', operator: 'endswith', value: 'pdf' }],
            actions: [{ type: 'move', targetFolderId: 'wf-1' }],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    expect(screen.getByText('Auto-archive PDFs')).toBeTruthy();
    // Trigger text is split across <p> + <span class="capitalize">; match the span.
    expect(screen.getByText('event')).toBeTruthy();
    expect(screen.getByText(/extension endswith "pdf"/)).toBeTruthy();
    expect(screen.getByText(/Move to wf-1/)).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('toggles a rule when Active button is clicked (calls mutate with inverted state)', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Rule',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByText('Active'));
    expect(toggleMutate).toHaveBeenCalledWith({ id: 'r1', isActive: false });
  });

  it('toggles an inactive rule to active when Inactive button clicked', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r2',
            userId: 'u',
            name: 'Rule',
            triggerType: 'cron',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: false,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByText('Inactive'));
    expect(toggleMutate).toHaveBeenCalledWith({ id: 'r2', isActive: true });
  });

  it('renders triggerType with capitalized first letter (capitalize class)', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Rule',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    const triggerSpan = screen.getByText('event');
    expect(triggerSpan.tagName).toBe('SPAN');
    expect(triggerSpan.className).toContain('capitalize');
  });

  it('renders multiple rules each with their own toggle button', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'A',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
          {
            id: 'r2',
            userId: 'u',
            name: 'B',
            triggerType: 'cron',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: false,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    expect(screen.getAllByText('Active')).toHaveLength(1);
    expect(screen.getAllByText('Inactive')).toHaveLength(1);
  });

  it('does not render rule list while loading', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        isLoading: true,
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Hidden',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    expect(screen.queryByText('Hidden')).toBeNull();
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('opens create modal when Create Rule button is clicked', () => {
    render(<AutomationsPage />);
    fireEvent.click(screen.getByText('Create'));
    expect(screen.getByTestId('create-modal')).toBeTruthy();
    expect(screen.getByText('editing:no')).toBeTruthy();
  });

  it('opens edit modal when Edit button is clicked', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Editable',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByLabelText('Edit Editable'));
    expect(screen.getByTestId('create-modal')).toBeTruthy();
    expect(screen.getByText('editing:yes')).toBeTruthy();
  });

  it('opens logs modal when logs button is clicked', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'With logs',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByLabelText('View logs for With logs'));
    expect(screen.getByTestId('logs-modal')).toBeTruthy();
    expect(screen.getByTestId('logs-modal').textContent).toBe('r1');
  });

  it('opens delete confirm dialog when Delete button is clicked', () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Deletable',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByLabelText('Delete Deletable'));
    expect(screen.getByTestId('confirm-dialog')).toBeTruthy();
    expect(screen.getByText(/Delete "Deletable"/)).toBeTruthy();
  });

  it('calls deleteMutateAsync when confirm is clicked', async () => {
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Deletable',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    fireEvent.click(screen.getByLabelText('Delete Deletable'));
    fireEvent.click(screen.getByTestId('confirm-btn'));
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('r1'));
  });

  it('resolves targetFolderId to folder name when workspace tree is loaded', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    (useQuery as Mock).mockReturnValue({
      data: { folders: [{ id: 'wf-1', name: 'Invoices' }] },
    });
    useAutomationsMock.mockReturnValue(
      mockHookReturn({
        data: [
          {
            id: 'r1',
            userId: 'u',
            name: 'Auto-archive',
            triggerType: 'event',
            triggerConfig: {},
            conditions: [],
            actions: [{ type: 'move', targetFolderId: 'wf-1' }],
            isActive: true,
            createdAt: '',
            updatedAt: '',
          },
        ],
      }),
    );
    render(<AutomationsPage />);
    expect(screen.getByText(/Move to Invoices/)).toBeTruthy();
  });
});
