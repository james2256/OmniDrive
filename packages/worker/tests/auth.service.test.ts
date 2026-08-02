import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthService } from '../src/services/auth.service';
import type { Env } from '../src/types/env';

const mockEnv = {
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
} as unknown as Env;

describe('AuthService', () => {
  let service: AuthService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new AuthService(mockEnv);
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exchangeCodeForTokens', () => {
    it('builds correct form body with code_verifier and returns parsed tokens', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-123',
            refresh_token: 'refresh-456',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const tokens = await service.exchangeCodeForTokens(
        'auth-code',
        'https://example.com/callback',
        'code-verifier-abc',
      );

      expect(tokens.accessToken).toBe('access-123');
      expect(tokens.refreshToken).toBe('refresh-456');
      expect(tokens.expiresAt).toBeGreaterThan(Date.now());

      // Verify the fetch was called with the correct form body
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init?.method).toBe('POST');
      const body = init?.body as URLSearchParams;
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-client-secret');
      expect(body.get('code_verifier')).toBe('code-verifier-abc');
      expect(body.get('grant_type')).toBe('authorization_code');
    });

    it('maps upstream HTTP error to AppError(502)', async () => {
      // 400 is non-retryable — withBackoff exhausts immediately and throws UpstreamError.
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_grant' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(
        service.exchangeCodeForTokens('bad-code', 'https://example.com/callback'),
      ).rejects.toMatchObject({
        status: 502,
        message: 'Failed to communicate with Google',
      });
    });

    it('maps network failure (fetch rejects) to AppError(502)', async () => {
      // withBackoff now retries TypeError (network errors) with sleep().
      // Use vi.useFakeTimers to avoid the real 7s backoff delay.
      vi.useFakeTimers();
      fetchSpy.mockRejectedValue(new TypeError('Connection refused'));

      const promise = service.exchangeCodeForTokens('code', 'https://example.com/callback');
      // Attach the rejection handler BEFORE running timers to prevent
      // unhandled rejection when vi.runAllTimersAsync resolves first.
      const expectation = expect(promise).rejects.toMatchObject({
        status: 502,
        message: 'Failed to communicate with Google',
      });
      // Fast-forward through all backoff sleeps (3 retries: ~1s + ~2s + ~4s = ~7s)
      await vi.runAllTimersAsync();
      await expectation;
      vi.useRealTimers();
    });
  });

  describe('fetchUserInfo', () => {
    it('sends Bearer token and returns parsed user info', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'google-user-123',
            email: 'user@gmail.com',
            name: 'Test User',
            picture: 'https://example.com/avatar.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const user = await service.fetchUserInfo('access-token-123');

      expect(user.id).toBe('google-user-123');
      expect(user.email).toBe('user@gmail.com');
      expect(user.name).toBe('Test User');
      expect(user.picture).toBe('https://example.com/avatar.jpg');

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/oauth2/v2/userinfo');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer access-token-123' });
    });

    it('maps upstream HTTP error to AppError(502)', async () => {
      // 401 from Google — non-retryable, throws UpstreamError.
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'invalid_token' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      await expect(service.fetchUserInfo('expired-token')).rejects.toMatchObject({
        status: 502,
        message: 'Failed to communicate with Google',
      });
    });
  });
});
