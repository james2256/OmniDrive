import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseServiceAccountJson, verifySharedFolderAccess } from '../src/lib/google-service-account';

const VALID_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n',
  client_email: 'sa@test-project.iam.gserviceaccount.com',
});

describe('parseServiceAccountJson', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseServiceAccountJson('not-json')).toThrow('Invalid service account JSON');
  });

  it('rejects missing fields', () => {
    expect(() => parseServiceAccountJson('{}')).toThrow('client_email and private_key');
  });

  it('parses valid service account JSON', () => {
    const sa = parseServiceAccountJson(VALID_SA);
    expect(sa.client_email).toBe('sa@test-project.iam.gserviceaccount.com');
  });
});

describe('verifySharedFolderAccess', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns folder metadata when accessible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'folder123', name: 'Shared Folder' }), { status: 200 })
    );

    const folder = await verifySharedFolderAccess('token', 'folder123');
    expect(folder).toEqual({ id: 'folder123', name: 'Shared Folder' });
  });

  it('throws when folder is inaccessible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(verifySharedFolderAccess('token', 'folder123')).rejects.toThrow(
      'Cannot access shared folder'
    );
  });
});