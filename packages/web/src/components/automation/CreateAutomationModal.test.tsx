// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { CreateAutomationModal } from './CreateAutomationModal';

const createMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const updateMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../hooks/useAutomations', () => ({
  useCreateAutomation: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateAutomation: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn().mockReturnValue({ data: { folders: [] } }),
}));

vi.mock('../../lib/api/folders', () => ({
  foldersApi: { getWorkspaceTree: vi.fn() },
}));

vi.mock('../../lib/queryKeys', () => ({
  qk: { workspaceTree: ['workspaceTree'] },
}));

vi.mock('../ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('../ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('../ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('lucide-react', () => ({
  Zap: () => <svg />,
  Plus: () => <svg />,
  Trash2: () => <svg />,
}));

describe('CreateAutomationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when open is false', () => {
    render(<CreateAutomationModal open={false} editingRule={null} onClose={vi.fn()} />);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('renders create form with empty fields when open with no editingRule', () => {
    render(<CreateAutomationModal open={true} editingRule={null} onClose={vi.fn()} />);
    expect(screen.getByText('Create Automation Rule')).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('e.g. Auto-archive PDFs') as HTMLInputElement;
    expect(nameInput.value).toBe('');
  });

  it('renders edit form with pre-filled fields when editingRule is provided', () => {
    const rule = {
      id: 'r1',
      userId: 'u',
      name: 'Existing rule',
      triggerType: 'cron' as const,
      triggerConfig: {},
      conditions: [{ field: 'name' as const, operator: 'contains' as const, value: 'temp' }],
      actions: [{ type: 'delete' as const }],
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };
    render(<CreateAutomationModal open={true} editingRule={rule} onClose={vi.fn()} />);
    expect(screen.getByText('Edit Automation Rule')).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('e.g. Auto-archive PDFs') as HTMLInputElement;
    expect(nameInput.value).toBe('Existing rule');
  });

  it('shows error when submitting with empty name', () => {
    render(<CreateAutomationModal open={true} editingRule={null} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Create'));
    expect(screen.getByText('Rule name is required')).toBeTruthy();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('calls createMutateAsync with the form body on submit', async () => {
    render(<CreateAutomationModal open={true} editingRule={null} onClose={vi.fn()} />);
    const nameInput = screen.getByPlaceholderText('e.g. Auto-archive PDFs');
    fireEvent.change(nameInput, { target: { value: 'My rule' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    const body = createMutateAsync.mock.calls[0][0];
    expect(body.name).toBe('My rule');
    expect(body.triggerType).toBe('event');
    expect(body.triggerConfig).toEqual({});
  });

  it('calls updateMutateAsync when editing an existing rule', async () => {
    const rule = {
      id: 'r-edit',
      userId: 'u',
      name: 'Old name',
      triggerType: 'event' as const,
      triggerConfig: {},
      conditions: [],
      actions: [],
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };
    const onClose = vi.fn();
    render(<CreateAutomationModal open={true} editingRule={rule} onClose={onClose} />);
    const nameInput = screen.getByPlaceholderText('e.g. Auto-archive PDFs');
    fireEvent.change(nameInput, { target: { value: 'New name' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutateAsync).toHaveBeenCalledWith({
      id: 'r-edit',
      body: expect.objectContaining({ name: 'New name' }),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('can add a second condition via Add condition button', () => {
    render(<CreateAutomationModal open={true} editingRule={null} onClose={vi.fn()} />);
    const before = screen.getAllByPlaceholderText('value (e.g. .pdf)').length;
    fireEvent.click(screen.getByText('Add condition'));
    const after = screen.getAllByPlaceholderText('value (e.g. .pdf)').length;
    expect(after).toBe(before + 1);
  });

  it('can add a second action via Add action button', () => {
    render(<CreateAutomationModal open={true} editingRule={null} onClose={vi.fn()} />);
    // Default action is "move" which shows a folder select. After adding, there are 2.
    const before = screen.getAllByText('Select workspace folder…').length;
    fireEvent.click(screen.getByText('Add action'));
    const after = screen.getAllByText('Select workspace folder…').length;
    expect(after).toBe(before + 1);
  });
});
