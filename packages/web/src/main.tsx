import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import { setUnauthorizedHandler } from './lib/api/core';
import { useAuthStore } from './stores/useAuthStore';
import './index.css';

// Register the 401 session-expiry handler. Breaks the circular dependency
// (core.ts → useAuthStore → authApi → core.ts) by avoiding a dynamic import
// in core.ts — the handler is injected at startup instead.
setUnauthorizedHandler(() => {
  useAuthStore.getState().clearAuth();
  window.location.href = '/login';
});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
