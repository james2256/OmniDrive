import { describe, it, expect } from 'vitest';
import { hashSharedPassword, verifySharedPassword } from '../src/lib/password';

describe('shared-link password hashing', () => {
  it('roundtrips create → verify with new shared: format (10k iterations)', async () => {
    const stored = await hashSharedPassword('secret-link-pass');
    expect(stored.startsWith('shared:10000:')).toBe(true);
    expect(await verifySharedPassword('secret-link-pass', stored)).toBe(true);
    expect(await verifySharedPassword('wrong', stored)).toBe(false);
  });

  it('verifies legacy salt:hash format (implicit 100k iterations)', async () => {
    const password = 'legacy-pass';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 },
      key,
      256,
    );
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('');
    const hashHex = Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
    const legacyStored = `${saltHex}:${hashHex}`;

    expect(await verifySharedPassword(password, legacyStored)).toBe(true);
    expect(await verifySharedPassword('wrong', legacyStored)).toBe(false);
  });
});