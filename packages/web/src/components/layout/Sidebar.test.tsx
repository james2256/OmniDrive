import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Sidebar', () => {
  it('should contain Workspaces link', () => {
    renderWithProviders(<Sidebar />);
    expect(screen.getByText('Workspaces')).toBeDefined();
    expect(screen.queryByText('Virtual Folders')).toBeNull();
  });
});
