// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthGuard } from './AuthGuard';
import { useAuthStore } from '../stores/useAuthStore';

vi.mock('../stores/useAuthStore', () => ({
  useAuthStore: vi.fn(),
}));

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

describe('AuthGuard', () => {
  const originalLocation = window.location;
  const fetchUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    // Restore real window.location between tests.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('renders children when authenticated and not loading', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      authError: null,
      fetchUser,
    });

    render(
      <AuthGuard>
        <div data-testid="protected">Secret content</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId('protected')).toBeTruthy();
    expect(screen.getByText('Secret content')).toBeTruthy();
  });

  it('calls fetchUser on mount (initial auth check)', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      authError: null,
      fetchUser,
    });

    render(
      <AuthGuard>
        <div data-testid="protected" />
      </AuthGuard>,
    );

    expect(fetchUser).toHaveBeenCalledTimes(1);
  });

  it('renders a loading spinner while isLoading is true (and not authenticated)', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
      authError: null,
      fetchUser,
    });

    const { container } = render(
      <AuthGuard>
        <div data-testid="protected" />
      </AuthGuard>,
    );

    // No children rendered while loading.
    expect(screen.queryByTestId('protected')).toBeNull();
    // The spinner is a styled <div> with `animate-spin` class.
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('redirects to /login via <Navigate> when not authenticated and not loading', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      authError: null,
      fetchUser,
    });

    // LocationCapture renders the current pathname so we can assert the redirect.
    const LocationCapture = () => {
      const location = useLocation();
      return <span data-testid="location">{location.pathname}</span>;
    };

    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route
            path="/protected"
            element={
              <AuthGuard>
                <div data-testid="protected" />
              </AuthGuard>
            }
          />
          <Route path="/login" element={<LocationCapture />} />
        </Routes>
      </MemoryRouter>,
    );

    // No children rendered — AuthGuard redirected away from /protected.
    expect(screen.queryByTestId('protected')).toBeNull();
    // <Navigate to="/login" replace /> rendered the /login route.
    expect(screen.getByTestId('location').textContent).toBe('/login');
  });

  it('renders the authError UI with a Retry button when authError is set (and not loading)', () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      authError: 'Connection lost',
      fetchUser,
    });

    render(
      <AuthGuard>
        <div data-testid="protected" />
      </AuthGuard>,
    );

    expect(screen.getByText('Connection lost')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // No children rendered while in the error state.
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('clicking Retry calls fetchUser again', async () => {
    (useAuthStore as unknown as Mock).mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      authError: 'Connection lost',
      fetchUser,
    });

    render(
      <AuthGuard>
        <div data-testid="protected" />
      </AuthGuard>,
    );

    // One call from initial mount.
    expect(fetchUser).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(fetchUser).toHaveBeenCalledTimes(2);
    });
  });
});
