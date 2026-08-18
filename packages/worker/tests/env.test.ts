import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateEnv } from '../src/lib/env';

function validBaseEnv() {
  return {
    DB: {},
    KV: {},
    SYNC_QUEUE: {},
    FRONTEND_URL: 'https://app.example.com',
    WORKER_URL: 'https://worker.example.com',
    JWT_SECRET: 'a'.repeat(32),
    TOKEN_ENCRYPTION_KEY: 'b'.repeat(32),
  };
}

describe('validateEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Silence console.error emitted on validation failure.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a fully valid environment', () => {
    const env = validBaseEnv();
    const result = validateEnv(env);
    expect(result.JWT_SECRET).toBe(env.JWT_SECRET);
    expect(result.TOKEN_ENCRYPTION_KEY).toBe(env.TOKEN_ENCRYPTION_KEY);
    expect(result.FRONTEND_URL).toBe(env.FRONTEND_URL);
    expect(result.WORKER_URL).toBe(env.WORKER_URL);
    expect(result.SYNC_QUEUE).toBe(env.SYNC_QUEUE);
  });

  it('accepts valid env with optional GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / BOOTSTRAP_TOKEN', () => {
    const env = {
      ...validBaseEnv(),
      GOOGLE_CLIENT_ID: 'id-123',
      GOOGLE_CLIENT_SECRET: 'secret-456',
      BOOTSTRAP_TOKEN: 'bootstrap-token-789',
    };
    const result = validateEnv(env);
    expect(result.GOOGLE_CLIENT_ID).toBe('id-123');
    expect(result.GOOGLE_CLIENT_SECRET).toBe('secret-456');
    expect(result.BOOTSTRAP_TOKEN).toBe('bootstrap-token-789');
  });

  it('throws when JWT_SECRET is missing', () => {
    const env = validBaseEnv();
    delete (env as { JWT_SECRET?: string }).JWT_SECRET;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when JWT_SECRET is shorter than 32 chars', () => {
    const env = { ...validBaseEnv(), JWT_SECRET: 'a'.repeat(31) };
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('accepts JWT_SECRET of exactly 32 chars', () => {
    const env = { ...validBaseEnv(), JWT_SECRET: 'a'.repeat(32) };
    expect(() => validateEnv(env)).not.toThrow();
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    const env = validBaseEnv();
    delete (env as { TOKEN_ENCRYPTION_KEY?: string }).TOKEN_ENCRYPTION_KEY;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when TOKEN_ENCRYPTION_KEY is shorter than 32 chars', () => {
    const env = { ...validBaseEnv(), TOKEN_ENCRYPTION_KEY: 'b'.repeat(31) };
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when FRONTEND_URL is missing', () => {
    const env = validBaseEnv();
    delete (env as { FRONTEND_URL?: string }).FRONTEND_URL;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when FRONTEND_URL is not a valid URL', () => {
    const env = { ...validBaseEnv(), FRONTEND_URL: 'not-a-url' };
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when WORKER_URL is not a valid URL', () => {
    const env = { ...validBaseEnv(), WORKER_URL: 'not-a-valid-url' };
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when required DB is missing', () => {
    const env = validBaseEnv();
    delete (env as { DB?: unknown }).DB;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when required KV is missing', () => {
    const env = validBaseEnv();
    delete (env as { KV?: unknown }).KV;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('throws when required SYNC_QUEUE is missing', () => {
    const env = validBaseEnv();
    delete (env as { SYNC_QUEUE?: unknown }).SYNC_QUEUE;
    expect(() => validateEnv(env)).toThrow('Environment validation failed');
  });

  it('ignores extra bindings (parses successfully, extras stripped from result)', () => {
    const env = {
      ...validBaseEnv(),
      EXTRA_BINDING: 'should-not-fail',
      ANOTHER_EXTRA: 123,
    };
    const result = validateEnv(env);
    expect(result).not.toHaveProperty('EXTRA_BINDING');
    expect(result).not.toHaveProperty('ANOTHER_EXTRA');
    // Required fields still present
    expect(result.JWT_SECRET).toBe(env.JWT_SECRET);
  });
});
