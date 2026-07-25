import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashSharedPassword, verifySharedPassword } from '../src/lib/password';

describe('password hashing (user accounts)', () => {
  it('hashPassword returns a pbkdf2-formatted string with 4 colon-separated parts', async () => {
    const hash = await hashPassword('TestPass123!');
    expect(hash).toMatch(/^pbkdf2:\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    const parts = hash.split(':');
    expect(parts[0]).toBe('pbkdf2');
    expect(parseInt(parts[1], 10)).toBe(10_000); // ITERATIONS constant
  });

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const ok = await verifyPassword('correct-horse-battery-staple', hash);
    expect(ok).toBe(true);
  });

  it('verifyPassword returns false for a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const ok = await verifyPassword('wrong-password', hash);
    expect(ok).toBe(false);
  });

  it('hashPassword uses a random salt — same password produces different hashes', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2); // different salts → different hashes

    // Both should still verify against the original password
    expect(await verifyPassword('same-password', hash1)).toBe(true);
    expect(await verifyPassword('same-password', hash2)).toBe(true);
  });

  it('verifyPassword returns false for a malformed hash string', async () => {
    expect(await verifyPassword('password', 'not-a-valid-hash')).toBe(false);
    expect(await verifyPassword('password', 'pbkdf2:10000:missing-parts')).toBe(false);
    expect(await verifyPassword('password', 'bcrypt:10:abc:def')).toBe(false);
  });
});

describe('shared-link password hashing', () => {
  it('hashSharedPassword returns a shared-formatted string', async () => {
    const hash = await hashSharedPassword('link-password');
    expect(hash).toMatch(/^shared:\d+:[0-9a-f]+:[0-9a-f]+$/);
    const parts = hash.split(':');
    expect(parts[0]).toBe('shared');
    expect(parseInt(parts[1], 10)).toBe(10_000);
  });

  it('verifySharedPassword returns true for the correct password', async () => {
    const hash = await hashSharedPassword('link-password');
    expect(await verifySharedPassword('link-password', hash)).toBe(true);
  });

  it('verifySharedPassword returns false for a wrong password', async () => {
    const hash = await hashSharedPassword('link-password');
    expect(await verifySharedPassword('wrong', hash)).toBe(false);
  });

  it('verifySharedPassword rejects malformed hashes', async () => {
    expect(await verifySharedPassword('password', 'not-valid')).toBe(false);
    expect(await verifySharedPassword('password', 'shared:abc:not-hex:not-hex')).toBe(false);
  });
});
