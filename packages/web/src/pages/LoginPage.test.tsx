// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { LoginPage } from './LoginPage';
import { authApi } from '../lib/api/auth';

vi.mock('../lib/api/auth', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    getGoogleOAuthUrl: vi.fn(),
    getDriveConnectUrl: vi.fn(),
    logout: vi.fn(),
    getUser: vi.fn(),
    getSetupStatus: vi.fn(),
    changePassword: vi.fn(),
  },
}));

vi.mock('../components/ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

describe('LoginPage', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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

  it('renders username and password inputs (login mode is the default)', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText('Username')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });

  it('renders the submit button labeled "Sign In" in login mode', () => {
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: /^Sign In$/ })).toBeTruthy();
  });

  it('renders the register toggle link', () => {
    render(<LoginPage />);

    expect(screen.getByText('Need an account? Register')).toBeTruthy();
  });

  it('submits username and password to authApi.login on form submit', async () => {
    (authApi.login as Mock).mockResolvedValue({ user: { id: 'u1', username: 'alice' } });
    stubLocationHref();

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass123' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    await waitFor(() => {
      expect(authApi.login).toHaveBeenCalledWith({ username: 'alice', password: 'pass123' });
    });
  });

  it('navigates to "/" via window.location.href on successful login', async () => {
    (authApi.login as Mock).mockResolvedValue({ user: { id: 'u1', username: 'alice' } });
    const hrefSetter = stubLocationHref();

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass123' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith('/');
    });
  });

  it('shows error message in an alert when login fails', async () => {
    (authApi.login as Mock).mockRejectedValue(new Error('Invalid credentials'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    expect(await screen.findByText('Invalid credentials')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('shows generic "Authentication failed" message when thrown value is not an Error', async () => {
    (authApi.login as Mock).mockRejectedValue('unexpected string error');

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    expect(await screen.findByText('Authentication failed')).toBeTruthy();
  });

  it('shows loading state on the submit button while submitting (button disabled + label changes)', async () => {
    // Never-resolving promise keeps loading state active.
    (authApi.login as Mock).mockReturnValue(new Promise(() => {}));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass123' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    expect(await screen.findByText('Signing in…')).toBeTruthy();
    // Button still rendered but its label is replaced with the loading text.
    expect(screen.queryByRole('button', { name: /^Sign In$/ })).toBeNull();
  });

  it('clears loading state after a failed login so the form can be retried', async () => {
    (authApi.login as Mock).mockRejectedValue(new Error('Invalid credentials'));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });

    fireEvent.click(screen.getByRole('button', { name: /^Sign In$/ }));

    expect(await screen.findByText('Invalid credentials')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Sign In$/ })).toBeTruthy();
    });
  });

  it('toggles to register mode when "Need an account? Register" clicked, showing extra fields', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByText('Need an account? Register'));

    // Register-mode extra fields appear.
    expect(screen.getByLabelText('Name')).toBeTruthy();
    expect(screen.getByLabelText('Email (Optional)')).toBeTruthy();
    expect(screen.getByLabelText('Invitation Code (Required)')).toBeTruthy();
    // The submit button label switches to "Create Account".
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
    // The toggle link switches text.
    expect(screen.getByText('Already have an account? Sign in')).toBeTruthy();
  });

  it('calls authApi.register with all fields on register-mode submit', async () => {
    (authApi.register as Mock).mockResolvedValue({ user: { id: 'u2', username: 'newbie' } });
    stubLocationHref();

    render(<LoginPage />);

    fireEvent.click(screen.getByText('Need an account? Register'));

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New User' } });
    fireEvent.change(screen.getByLabelText('Email (Optional)'), { target: { value: 'n@e.com' } });
    fireEvent.change(screen.getByLabelText('Invitation Code (Required)'), {
      target: { value: 'INV123' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(authApi.register).toHaveBeenCalledWith({
        name: 'New User',
        username: 'newbie',
        password: 'pass123',
        email: 'n@e.com',
        invitation_code: 'INV123',
      });
    });
  });

  it('navigates to "/" on successful register', async () => {
    (authApi.register as Mock).mockResolvedValue({ user: { id: 'u2', username: 'newbie' } });
    const hrefSetter = stubLocationHref();

    render(<LoginPage />);

    fireEvent.click(screen.getByText('Need an account? Register'));

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'newbie' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New User' } });
    fireEvent.change(screen.getByLabelText('Invitation Code (Required)'), {
      target: { value: 'INV123' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pass123' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));

    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith('/');
    });
  });

  it('toggles back to login mode when "Already have an account? Sign in" clicked', () => {
    render(<LoginPage />);

    // Switch to register mode first.
    fireEvent.click(screen.getByText('Need an account? Register'));
    expect(screen.getByLabelText('Name')).toBeTruthy();

    // Switch back to login mode.
    fireEvent.click(screen.getByText('Already have an account? Sign in'));

    // Register-mode-only fields are unmounted.
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByLabelText('Email (Optional)')).toBeNull();
    expect(screen.queryByLabelText('Invitation Code (Required)')).toBeNull();
    // Login-mode submit button label restored.
    expect(screen.getByRole('button', { name: /^Sign In$/ })).toBeTruthy();
  });

  it('renders Terms of Service and Privacy Policy links', () => {
    render(<LoginPage />);

    expect(screen.getByText('Terms of Service').closest('a')?.getAttribute('href')).toBe('/terms');
    expect(screen.getByText('Privacy Policy').closest('a')?.getAttribute('href')).toBe('/privacy');
  });
});
