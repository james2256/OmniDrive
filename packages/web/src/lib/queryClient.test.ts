import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { queryClient } from './queryClient';

// `queryClient` is a singleton `QueryClient` instance with documented default
// options. These tests assert the exact config values so an accidental change
// (e.g. dropping `staleTime`, enabling `refetchOnWindowFocus`) is caught.

describe('queryClient', () => {
  it('is a QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('defaultOptions.queries.staleTime = 30_000', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(30_000);
  });

  it('defaultOptions.queries.retry = 1', () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(1);
  });

  it('defaultOptions.queries.refetchOnWindowFocus = false', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });

  it('does not set refetchOnMount (defaults to true)', () => {
    // Source leaves this as the TanStack default (true); explicit undefined means
    // "inherit default", which equals true.
    expect(queryClient.getDefaultOptions().queries?.refetchOnMount).toBeUndefined();
  });

  it('does not set gcTime (defaults to 5 minutes)', () => {
    // Source leaves this as the TanStack default; explicit undefined means inherit.
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBeUndefined();
  });

  it('defaultOptions.mutations is not customized (undefined)', () => {
    expect(queryClient.getDefaultOptions().mutations).toBeUndefined();
  });
});
