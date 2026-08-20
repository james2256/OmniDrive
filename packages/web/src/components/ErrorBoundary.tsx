import React from 'react';
import { Button } from './ui/Button';

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render errors in the subtree so a single page crash doesn't
 * blank the entire app. Placed inside <BrowserRouter> so navigation
 * still works after an error.
 *
 * Route-change reset: App.tsx passes `resetKey={location.pathname}`. When
 * the route changes, `componentDidUpdate` detects the prop change and clears
 * `hasError` — WITHOUT unmounting children. This is critical: using `key`
 * instead would unmount the entire <Suspense> boundary, discarding the
 * lazy-component cache and flashing "Loading…" on every navigation.
 *
 * In-place recovery: the "Try Again" button clears the error state so the
 * subtree re-renders. If the underlying data is still bad, the error
 * boundary catches again — but if it was a transient render issue, the
 * page recovers immediately.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; resetKey?: string },
  State
> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
  }

  componentDidUpdate(prevProps: { resetKey?: string }) {
    // Reset error state when resetKey changes (route navigation) — without
    // unmounting children. This avoids re-suspending lazy-loaded pages
    // (which would flash "Loading…" on every navigation).
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error('Render error caught:', err, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-surface px-4">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-600 text-center max-w-sm" role="alert">
            {this.state.message}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="md"
            className="rounded-lg text-slate-800 hover:bg-slate-50"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Try Again
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}
