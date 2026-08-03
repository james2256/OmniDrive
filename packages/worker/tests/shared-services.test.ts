import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types/env';

// Mock GoogleDriveService so we can assert constructor args without hitting the network.
vi.mock('../src/services/google-drive', () => ({
  GoogleDriveService: vi.fn().mockImplementation(function (
    this: any,
    db: any,
    clientId: string,
    clientSecret: string,
    encryptionKey?: string,
  ) {
    this.db = db;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.encryptionKey = encryptionKey;
  }),
}));

// Mock SharedService so we can assert the constructor is invoked with c.env.DB.
vi.mock('../src/services/shared.service', () => ({
  SharedService: vi.fn().mockImplementation(function (this: any, db: any) {
    this.db = db;
  }),
}));

import { createDriveService } from '../src/lib/drive-factory';
import { sharedServices } from '../src/middleware/shared-services';
import { GoogleDriveService } from '../src/services/google-drive';
import { SharedService } from '../src/services/shared.service';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: { markAsMockDb: true } as unknown as D1Database,
    KV: {} as KVNamespace,
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    FRONTEND_URL: 'https://app.example.com',
    WORKER_URL: 'https://api.example.com',
    JWT_SECRET: 'test-jwt-secret',
    TOKEN_ENCRYPTION_KEY: 'test-encryption-key',
    ...overrides,
  } as Env;
}

describe('createDriveService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('constructs a GoogleDriveService with the env values', () => {
    const env = makeEnv();
    createDriveService(env);
    expect(GoogleDriveService).toHaveBeenCalledTimes(1);
    expect(GoogleDriveService).toHaveBeenCalledWith(
      env.DB,
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.TOKEN_ENCRYPTION_KEY,
    );
  });

  it('returns a GoogleDriveService instance', () => {
    const env = makeEnv();
    const service = createDriveService(env);
    expect(service).toBeInstanceOf(GoogleDriveService);
  });

  it('constructs a fresh instance on every call (no caching at the factory level)', () => {
    const env = makeEnv();
    const a = createDriveService(env);
    const b = createDriveService(env);
    expect(a).not.toBe(b);
    expect(GoogleDriveService).toHaveBeenCalledTimes(2);
  });

  it('uses only the narrowed DriveServiceEnv subset (DB + 3 google/encryption fields)', () => {
    // createDriveService must not require the full Env — only the 4 fields it uses.
    const narrowEnv = {
      DB: { narrow: true } as unknown as D1Database,
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'secret',
      TOKEN_ENCRYPTION_KEY: 'key',
    };
    createDriveService(narrowEnv);
    expect(GoogleDriveService).toHaveBeenCalledWith(narrowEnv.DB, 'cid', 'secret', 'key');
  });
});

describe('sharedServices middleware', () => {
  function createApp(env: Env = makeEnv()) {
    const app = new Hono<{ Bindings: Env; Variables: { sharedService: SharedService } }>();
    app.use('*', sharedServices);
    app.get('/test', (c) => c.json({ has: !!c.get('sharedService') }));
    return { app, env };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects sharedService into the context (accessible via c.get)', async () => {
    const { app, env } = createApp();
    const res = await app.request('/test', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.has).toBe(true);
  });

  it('constructs SharedService with c.env.DB', async () => {
    const { app, env } = createApp();
    await app.request('/test', {}, env);
    expect(SharedService).toHaveBeenCalledTimes(1);
    expect(SharedService).toHaveBeenCalledWith(env.DB);
  });

  it('the injected sharedService is an instance of SharedService', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { sharedService: SharedService } }>();
    app.use('*', sharedServices);
    let captured: SharedService | undefined;
    app.get('/test', (c) => {
      captured = c.get('sharedService');
      return c.json({ ok: true });
    });
    const env = makeEnv();
    await app.request('/test', {}, env);
    expect(captured).toBeInstanceOf(SharedService);
  });

  it('caches the SharedService per-request (same instance on multiple c.get calls)', async () => {
    const app = new Hono<{ Bindings: Env; Variables: { sharedService: SharedService } }>();
    app.use('*', sharedServices);
    let firstGet: SharedService | undefined;
    let secondGet: SharedService | undefined;
    let thirdGet: SharedService | undefined;
    app.get('/test', (c) => {
      firstGet = c.get('sharedService');
      secondGet = c.get('sharedService');
      thirdGet = c.get('sharedService');
      return c.json({ ok: true });
    });
    const env = makeEnv();
    await app.request('/test', {}, env);
    expect(firstGet).toBeDefined();
    expect(secondGet).toBeDefined();
    expect(thirdGet).toBeDefined();
    expect(firstGet).toBe(secondGet);
    expect(secondGet).toBe(thirdGet);
  });

  it('constructs a fresh SharedService on each request (no cross-request caching)', async () => {
    const { app, env } = createApp();
    await app.request('/test', {}, env);
    await app.request('/test', {}, env);
    expect(SharedService).toHaveBeenCalledTimes(2);
  });

  it('calls next() so downstream handlers still run', async () => {
    const { app, env } = createApp();
    const res = await app.request('/test', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.has).toBe(true);
  });
});
