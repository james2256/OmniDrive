import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseServiceAccountJson,
  verifySharedFolderAccess,
  fetchServiceAccountAccessToken,
} from '../src/lib/google-service-account';

const VALID_SA = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key:
    '-----BEGIN PRIVATE KEY-----\nMIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA\n-----END PRIVATE KEY-----\n',
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
      new Response(JSON.stringify({ id: 'folder123', name: 'Shared Folder' }), { status: 200 }),
    );

    const folder = await verifySharedFolderAccess('token', 'folder123');
    expect(folder).toEqual({ id: 'folder123', name: 'Shared Folder' });
  });

  it('throws when folder is inaccessible', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }));

    await expect(verifySharedFolderAccess('token', 'folder123')).rejects.toThrow(
      'Cannot access shared folder',
    );
  });
});

describe('pemToPkcs8 + sign (regression: literal PEM header, not regex)', () => {
  // Regression test for the scanner false-positive bug where the PEM header
  // was matched via a character-class regex instead of a literal string.
  // This test signs a JWT with a real RSA keypair end-to-end, verifying
  // that pemToPkcs8 correctly strips the -----BEGIN PRIVATE KEY----- marker.
  it('signs a JWT with a real RSA keypair (end-to-end)', async () => {
    // Generate a real RSA keypair for testing
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );

    // Export the private key in PKCS8 PEM format
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
    const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;

    // Mock fetch to capture the JWT from the token request
    let capturedJwt = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
      const body = init?.body as string;
      const params = new URLSearchParams(body);
      const assertion = params.get('assertion');
      if (assertion) capturedJwt = assertion;
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), {
        status: 200,
      });
    });

    await fetchServiceAccountAccessToken({
      clientEmail: 'sa@test-project.iam.gserviceaccount.com',
      privateKey: pem,
    });

    // Verify the JWT was signed (not empty)
    expect(capturedJwt).toBeTruthy();
    expect(capturedJwt.split('.').length).toBe(3);

    // Verify the signature is valid using the public key
    const [header, payload, signature] = capturedJwt.split('.');
    const signingInput = `${header}.${payload}`;
    // JWT uses base64url encoding — convert to standard base64 for atob
    const sigB64 = signature.replace(/-/g, '+').replace(/_/g, '/');
    const sigBytes = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      keyPair.publicKey,
      sigBytes,
      new TextEncoder().encode(signingInput),
    );
    expect(valid).toBe(true);
  });
});
