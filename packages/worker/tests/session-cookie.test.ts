import { describe, expect, it } from 'vitest';
import { isSameSiteDeployment, sessionCookieOptions, SESSION_TTL_SEC } from '../src/lib/session-cookie';

describe('session-cookie', () => {
  it('detects same host', () => {
    expect(
      isSameSiteDeployment({
        FRONTEND_URL: 'https://omnidrive-7w1.pages.dev',
        WORKER_URL: 'https://omnidrive-7w1.pages.dev',
      })
    ).toBe(true);
  });

  it('detects same registrable domain across subdomains', () => {
    expect(
      isSameSiteDeployment({
        FRONTEND_URL: 'https://omnidrive-7w1.pages.dev',
        WORKER_URL: 'https://api.omnidrive-7w1.pages.dev',
      })
    ).toBe(true);
  });

  it('detects cross-site workers.dev vs custom domain', () => {
    expect(
      isSameSiteDeployment({
        FRONTEND_URL: 'https://omnidrive-7w1.pages.dev',
        WORKER_URL: 'https://omnidrive-api.asmara-putra.workers.dev',
      })
    ).toBe(false);
  });

  it('uses Lax session cookie with 7-day maxAge', () => {
    const opts = sessionCookieOptions({
      FRONTEND_URL: 'https://omnidrive-7w1.pages.dev',
      WORKER_URL: 'https://omnidrive-api.asmara-putra.workers.dev',
    });
    expect(opts.sameSite).toBe('Lax');
    expect(opts.httpOnly).toBe(true);
    expect(opts.maxAge).toBe(SESSION_TTL_SEC);
    expect(opts.secure).toBe(true);
  });

  it('allows insecure cookies on local http dev', () => {
    const opts = sessionCookieOptions({
      FRONTEND_URL: 'http://localhost:8999',
      WORKER_URL: 'http://localhost:8888',
    });
    expect(opts.secure).toBe(false);
    expect(opts.sameSite).toBe('Lax');
  });
});