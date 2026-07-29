import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../src/lib/cursor';

describe('encodeCursor', () => {
  it('encodes a simple object to base64url (no +, /, =)', () => {
    const cursor = encodeCursor({ id: 'abc', ts: 123 });
    // base64url alphabet: A-Z a-z 0-9 - _
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain('=');
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
  });

  it('encodes a payload deterministically (same input → same output)', () => {
    expect(encodeCursor({ a: 1 })).toBe(encodeCursor({ a: 1 }));
  });

  it('encodes empty object', () => {
    const encoded = encodeCursor({});
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    expect(decodeCursor(encoded)).toEqual({});
  });

  it('encodes nested payload', () => {
    const payload = { cursor: { id: 'x', n: 5 }, extra: null };
    const encoded = encodeCursor(payload);
    expect(decodeCursor(encoded)).toEqual(payload);
  });
});

describe('decodeCursor', () => {
  it('round-trips a simple payload', () => {
    const payload = { id: 'file-1', ts: 1700000000 };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('round-trips string and number values', () => {
    const payload = { name: 'foo', count: 42, flag: true };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('round-trips a payload containing characters that need UTF-8 encoding', () => {
    const payload = { id: 'äöü-日本語-🚀' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('decodes a cursor encoded with url-unsafe base64 chars (verifies -/_ mapping)', () => {
    // Construct a base64 string with + and / and verify decodeCursor accepts
    // the base64url variant (- and _).
    const payload = { id: '??>>==' }; // arbitrary payload likely to contain + and / in raw base64
    const raw = encodeCursor(payload); // base64url
    expect(decodeCursor(raw)).toEqual(payload);
  });

  it('returns null for invalid base64', () => {
    expect(decodeCursor('!!!not-base64!!!')).toBeNull();
  });

  it('returns null for malformed JSON (valid base64 of non-JSON)', () => {
    // base64 of "not json" — decode will succeed at base64 layer, fail at JSON.parse
    const text = 'not json';
    const binString = Array.from(new TextEncoder().encode(text), (b) =>
      String.fromCharCode(b),
    ).join('');
    const raw = btoa(binString);
    expect(decodeCursor(raw)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for base64 of empty buffer (decodes to empty string, JSON.parse fails)', () => {
    // atob('') === '' → JSON.parse('') throws
    expect(decodeCursor('')).toBeNull();
  });

  it('decodes a plain JSON object string wrapped in base64url', () => {
    const payload = { after: '2024-01-01T00:00:00Z' };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor(encoded);
    expect(decoded).toEqual(payload);
  });

  it('round-trips an array payload', () => {
    const payload = [1, 2, 3, 'four'];
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });
});
