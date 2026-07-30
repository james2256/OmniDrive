// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AdminUsersPage } from './AdminUsersPage';
import { useAuthStore } from '../stores/useAuthStore';
import { adminApi } from '../lib/api/admin';
import { useQuery } from '@tanstack/react-query';

// Mock the auth store
vi.mock('../stores/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}));

// Mock API
vi.mock('../lib/api/admin', () => ({
  adminApi: {
    getAdminUsers: vi.fn(),
    adminCreateUser: vi.fn(),
    getInvitations: vi.fn(),
    createInvitation: vi.fn(),
    deleteInvitation: vi.fn(),
  },
}));

// Mock TanStack Query — useQuery returns data directly (never calls queryFn).
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Mock queryKeys
vi.mock('../lib/queryKeys', () => ({
  qk: { adminUsers: ['adminUsers'], adminInvitations: ['adminInvitations'] },
}));

// Mock the lucide-react icons
vi.mock('lucide-react', () => ({
  ShieldAlert: () => <div data-testid="shield-alert-icon" />,
  Plus: () => <div data-testid="plus-icon" />,
  EllipsisVertical: () => <div data-testid="more-vertical-icon" />,
  X: () => <div data-testid="x-icon" />,
  TriangleAlert: () => <div data-testid="triangle-alert-icon" />,
  LoaderCircle: () => <div data-testid="loader-circle-icon" />,
  UserPlus: () => <div data-testid="user-plus-icon" />,
  UserCog: () => <div data-testid="user-cog-icon" />,
}));

vi.mock('../components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown-menu">{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <div data-testid="dropdown-trigger">{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div data-testid="dropdown-content">{children}</div>,
  DropdownMenuItem: ({ children, onClick, onSelect }: any) => (
    <button data-testid="dropdown-item" onClick={onClick || onSelect}>
      {children}
    </button>
  ),
}));

vi.mock('../components/ui/dialog', () => ({
  Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogBody: ({ children }: any) => <div>{children}</div>,
  // Render DialogTitle as an <h2> so it carries role="heading", matching the
  // real Radix DialogTitle semantics and enabling getByRole('heading', ...).
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, loading, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {loading ? 'Loading...' : children}
    </button>
  ),
}));

vi.mock('../components/ui/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (adminApi.getAdminUsers as Mock).mockResolvedValue({ users: [] });
    (adminApi.getInvitations as Mock).mockResolvedValue({ invitations: [] });
    // useQuery mock returns data directly (queryFn is never called by the mock).
    // Both queries fetch on mount — no enabled flag, no tab-conditional fetch.
    (useQuery as Mock).mockImplementation(({ queryKey }) => {
      if (queryKey[0] === 'adminUsers') {
        return { data: { users: [] }, isLoading: false, isError: false };
      }
      if (queryKey[0] === 'adminInvitations') {
        return { data: { invitations: [] }, isLoading: false, isError: false };
      }
      return { data: undefined, isLoading: false, isError: false };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders access denied for non-admin users', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      user: { id: 'user1', role: 'member' },
    });

    render(<AdminUsersPage />);

    expect(screen.getByText('Access Denied')).toBeTruthy();
    expect(screen.getByText('You do not have permission to view this page.')).toBeTruthy();
  });

  it('renders the user management page for admin users', async () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      user: { id: 'admin1', role: 'super_admin' },
    });

    render(<AdminUsersPage />);

    expect(await screen.findByText('Users')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add user/i })).toBeTruthy();
    // useQuery is called with the adminUsers key (queryFn is mocked, not called)
    expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['adminUsers'] }));
  });

  it('opens and closes the add user modal', async () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      user: { id: 'admin1', role: 'super_admin' },
    });

    render(<AdminUsersPage />);

    // Open modal
    const addBtn = await screen.findByRole('button', { name: /add user/i });
    fireEvent.click(addBtn);

    // Dialog title renders as a heading; the toolbar button is a <button>,
    // so this uniquely targets the modal title (not the button span).
    expect(screen.getByRole('heading', { name: 'Add User' })).toBeTruthy();

    // Close modal
    fireEvent.click(screen.getByText('Cancel'));

    await waitFor(() => {
      // Dialog unmounts its title; no heading named 'Add User' should remain
      // (the toolbar 'Add User' is a button, not a heading).
      expect(screen.queryAllByRole('heading', { name: 'Add User' })).toHaveLength(0);
    });
  });

  it('toggles tabs and loads invitations', async () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      user: { id: 'admin1', role: 'super_admin' },
    });

    render(<AdminUsersPage />);

    // Both queries register on mount (no tab-conditional fetch after migration)
    expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['adminUsers'] }));
    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['adminInvitations'] }),
    );

    const invTab = await screen.findByText('Invitation Codes');
    fireEvent.click(invTab);

    // Tab click shows invitations UI (data already cached from mount)
    expect(screen.getByText('Create Code')).toBeTruthy();
  });
});
