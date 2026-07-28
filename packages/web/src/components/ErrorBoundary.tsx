import React from 'react';
import { Button } from './ui/Button';

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Catches render errors in the subtree so a single page crash doesn't
 * blank the entire app. Placed inside <BrowserRouter> so navigation
 * still works after an error — user can click "Go Home" to recover.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
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
            onClick={() => (window.location.href = '/')}
          >
            Go Home
          </Button>
        </main>
      );
    }
    return this.props.children;
  }
}
