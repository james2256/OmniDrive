import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Agentation } from 'agentation';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import './index.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <Agentation endpoint="http://localhost:4747" />}
    </QueryClientProvider>
  </StrictMode>
);
