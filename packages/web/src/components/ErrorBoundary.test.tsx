// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('./ui/Button', () => ({
  Button: ({ children, onClick, disabled, type, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} type={type} {...props}>
      {children}
    </button>
  ),
}));

// Child that throws during render — exercises the error-boundary catch path.
function ThrowingChild(): React.JSX.Element {
  throw new Error('boom from render');
}

// Child with a button whose onClick throws — exercises the React limitation
// that event-handler errors are NOT caught by ErrorBoundary.
function ChildWithHandler(): React.JSX.Element {
  return (
    <button
      data-testid="handler-button"
      onClick={() => {
        throw new Error('handler boom');
      }}
    >
      Click me
    </button>
  );
}

describe('ErrorBoundary', () => {
  const originalLocation = window.location;
  let errorSpy: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    // Silence React's "Render error caught:" + the unhandled-render-error overlay.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) as unknown as Mock;
  });

  afterEach(() => {
    cleanup();
    errorSpy.mockRestore();
    // Restore the real window.location between tests.
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  // (stubLocationHref helper removed — "Try Again" uses setState, not navigation)

  it('renders children when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello world</div>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Hello world')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('catches render errors and shows the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    // The fallback renders the captured error.message.
    expect(screen.getByText('boom from render')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
    // The throwing child is no longer rendered (boundary replaced it).
    expect(screen.queryByText('Hello world')).toBeNull();
    // componentDidCatch logs the error to console.error.
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does NOT catch errors thrown in event handlers (React limitation)', () => {
    // Suppress the unhandled-error event React/jsdom raises when the click
    // handler throws — we're testing the boundary's behavior, not whether
    // Vitest surfaces the click-handler throw.
    const errorHandler = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', errorHandler);

    try {
      render(
        <ErrorBoundary>
          <ChildWithHandler />
        </ErrorBoundary>,
      );

      // Child is rendered (no fallback) before the click.
      expect(screen.getByTestId('handler-button')).toBeTruthy();
      expect(screen.queryByText('Something went wrong')).toBeNull();

      // Click the button — the onClick throws. React's ErrorBoundary
      // does NOT catch event-handler errors (this is the React limitation).
      // Swallow the synchronous throw, if any (React 18 + testing-library
      // surfaces it asynchronously via act()).
      try {
        fireEvent.click(screen.getByTestId('handler-button'));
      } catch {
        // some setups throw synchronously; either is fine for this assertion
      }

      // After the throw, ErrorBoundary is STILL showing the child (no fallback).
      expect(screen.getByTestId('handler-button')).toBeTruthy();
      expect(screen.queryByText('Something went wrong')).toBeNull();
    } finally {
      window.removeEventListener('error', errorHandler);
    }
  });

  it('clicking "Try Again" clears the error state and re-renders children', () => {
    // After an error, clicking "Try Again" clears hasError so the subtree
    // re-renders. If the error was transient (e.g. a stale prop that's since
    // been fixed), the page recovers without a hard refresh.
    let shouldThrow = true;

    function ConditionalChild() {
      if (shouldThrow) throw new Error('boom from render');
      return <div data-testid="recovered">Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>,
    );

    // Error state — "Try Again" button is visible.
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();

    // Fix the underlying issue, then click "Try Again".
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));

    // Error state cleared — child renders normally.
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByTestId('recovered')).toBeTruthy();
  });

  it('resets error state when resetKey prop changes (route-change reset)', () => {
    // App.tsx passes resetKey={location.pathname} so componentDidUpdate
    // resets hasError on navigation — WITHOUT unmounting children (which
    // would discard the lazy-component cache and flash "Loading…").
    let shouldThrow = true;

    function ConditionalChild() {
      if (shouldThrow) throw new Error('boom from render');
      return <div data-testid="recovered">Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary resetKey="page-1">
        <ConditionalChild />
      </ErrorBoundary>,
    );

    // Error state on first render.
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    // Fix the underlying issue, then change resetKey (simulating navigation).
    shouldThrow = false;
    rerender(
      <ErrorBoundary resetKey="page-2">
        <ConditionalChild />
      </ErrorBoundary>,
    );

    // Error state cleared by componentDidUpdate — child renders normally.
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.getByTestId('recovered')).toBeTruthy();
  });
});
