// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SetupPage } from './SetupPage';
import { authApi } from '../lib/api/auth';

vi.mock('../lib/api/auth', () => ({
  authApi: {
    register: vi.fn(),
  },
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, loading, ...props }: any) => (
    <button onClick={onClick} disabled={disabled || loading} type={type} {...props}>
      {loading ? 'Loading...' : children}
    </button>
  ),
}));

describe('SetupPage', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  // Helper: stub window.location.href with a setter that records assignments.
  const stubLocationHref = () => {
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        set href(url: string) {
          hrefSetter(url);
        },
        get href() {
          return '';
        },
      },
    });
    return hrefSetter;
  };

  it('renders setup form with username, password, and submit button', () => {
    render(<SetupPage />);

    expect(screen.getByText('Welcome to OmniDrive')).toBeTruthy();
    expect(screen.getByText('Create the first Super Admin account to get started.')).toBeTruthy();
    expect(screen.getByLabelText('Admin Username')).toBeTruthy();
    expect(screen.getByLabelText('Admin Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /complete setup/i })).toBeTruthy();
  });

  it('renders an optional invitation-code field for bootstrap token', () => {
    render(<SetupPage />);
    expect(screen.getByLabelText(/Invitation Code.*Bootstrap Token/i)).toBeTruthy();
  });

  it('passes invitation_code to register when provided', async () => {
    (authApi.register as Mock).mockResolvedValue({
      user: { id: 'u1', username: 'admin' },
    });
    stubLocationHref();

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Invitation Code.*Bootstrap Token/i), {
      target: { value: 'my-token' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => {
      expect(authApi.register).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'admin',
          password: 'password123',
          invitation_code: 'my-token',
        }),
      );
    });
  });

  it('submits form with username and password, calling authApi.register', async () => {
    (authApi.register as Mock).mockResolvedValue({
      user: { id: 'u1', username: 'admin' },
    });
    // Stub href to prevent jsdom navigation side-effects when register resolves.
    stubLocationHref();

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => {
      expect(authApi.register).toHaveBeenCalledWith({
        username: 'admin',
        password: 'password123',
      });
    });
  });

  it('redirects to "/" via window.location.href on successful setup', async () => {
    (authApi.register as Mock).mockResolvedValue({
      user: { id: 'u1', username: 'admin' },
    });
    const hrefSetter = stubLocationHref();

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith('/');
    });
  });

  it('shows error message when setup API call fails', async () => {
    (authApi.register as Mock).mockRejectedValue(new Error('Username already taken'));

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    expect(await screen.findByText('Username already taken')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows generic "Setup failed" when thrown value is not an Error', async () => {
    (authApi.register as Mock).mockRejectedValue('unexpected string error');

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    expect(await screen.findByText('Setup failed')).toBeTruthy();
  });

  it('shows loading state on the submit button while submitting', async () => {
    // Never-resolving promise keeps loading state active.
    (authApi.register as Mock).mockReturnValue(new Promise(() => {}));

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    expect(await screen.findByText('Creating…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /complete setup/i })).toBeNull();
  });

  it('clears loading state after a failed submission so the form can be retried', async () => {
    (authApi.register as Mock).mockRejectedValue(new Error('Username already taken'));

    render(<SetupPage />);

    fireEvent.change(screen.getByLabelText('Admin Username'), {
      target: { value: 'admin' },
    });
    fireEvent.change(screen.getByLabelText('Admin Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));

    // Error appears, and button reverts from "Creating…" back to "Complete Setup".
    expect(await screen.findByText('Username already taken')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /complete setup/i })).toBeTruthy();
    });
  });
});
