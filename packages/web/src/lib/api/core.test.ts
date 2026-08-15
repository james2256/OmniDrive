import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { request, ApiError } from './core';

// Mock useAuthStore to verify clearAuth is called on 401 (without triggering
// the real store's side effects).
vi.mock('../../stores/useAuthStore', () => ({
  useAuthStore: {
    getState: vi.fn(() => ({
      clearAuth: vi.fn(),
    })),
  },
}));

// Mock window.location.href (jsdom doesn't allow setting it directly).
const mockLocation = { href: '' };
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

describe('request — 401 interceptor', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
    mockLocation.href = '';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('redirects to /login on 401 from a non-shared endpoint', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      ) as unknown as typeof globalThis.fetch;

    await expect(request('/api/files', { method: 'GET' })).rejects.toThrow('Session expired');

    expect(mockLocation.href).toBe('/login');
  });

  it('does NOT redirect on 401 from /api/shared/ (shared-link password flow)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Password required' }), { status: 401 }),
      ) as unknown as typeof globalThis.fetch;

    await expect(request('/api/shared/abc123/meta', { method: 'GET' })).rejects.toThrow(
      'Password required',
    );

    // No redirect — the shared-link component handles the 401.
    expect(mockLocation.href).toBe('');
  });

  it('does NOT redirect on 401 from /api/auth/login (login endpoint itself)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 }),
      ) as unknown as typeof globalThis.fetch;

    await expect(request('/api/auth/login', { method: 'POST', body: '{}' })).rejects.toThrow(
      'Invalid credentials',
    );

    expect(mockLocation.href).toBe('');
  });

  it('does NOT redirect on 401 from /api/auth/register (register endpoint)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Username exists' }), { status: 401 }),
      ) as unknown as typeof globalThis.fetch;

    await expect(request('/api/auth/register', { method: 'POST', body: '{}' })).rejects.toThrow(
      'Username exists',
    );

    expect(mockLocation.href).toBe('');
  });

  it('does NOT redirect on non-401 errors (e.g. 403)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
      ) as unknown as typeof globalThis.fetch;

    await expect(request('/api/files', { method: 'DELETE' })).rejects.toThrow('Forbidden');

    expect(mockLocation.href).toBe('');
  });

  it('throws ApiError with status 401 on redirect (stops the request chain)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      ) as unknown as typeof globalThis.fetch;

    try {
      await request('/api/files');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(401);
      expect((err as ApiError).message).toBe('Session expired');
    }
  });
});
