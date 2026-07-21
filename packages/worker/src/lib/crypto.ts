import { logNoCtx } from './logger';

const ALGORITHM = 'AES-GCM';
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const KEY_VERSION = 'v1'; // ponytail: versioned ciphertext for future key rotation

async function getKey(secret: string): Promise<CryptoKey> {
  // ponytail: HKDF-SHA256 via Web Crypto — replaces the old truncate+zero-pad approach.
  // No extra dep, proper entropy diffusion even for short secrets.
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('omnidrive-token-v1'), info: new Uint8Array(0) },
    baseKey,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encrypt(plaintext: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoder = new TextEncoder();

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoder.encode(plaintext)
  );

  // Format: version:base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return `${KEY_VERSION}:${btoa(String.fromCharCode(...combined))}`;
}

export async function decrypt(encoded: string, secret: string): Promise<string> {
  const key = await getKey(secret);
  // Strip version prefix if present (v1:), otherwise treat as legacy base64
  const raw = encoded.includes(':') ? encoded.split(':').slice(1).join(':') : encoded;
  const combined = Uint8Array.from(atob(raw), c => c.charCodeAt(0));

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

export async function decryptOrPassthrough(value: string, secret: string): Promise<string> {
  // ponytail: only accept plaintext with explicit 'plain:' marker — bare values are rejected
  if (value.startsWith('plain:')) {
    logNoCtx('warn', 'decryptOrPassthrough: falling back to explicit plaintext marker');
    return value.slice(6);
  }
  try {
    return await decrypt(value, secret);
  } catch (e) {
    logNoCtx('error', 'decryptOrPassthrough: decryption failed and no plain: marker', undefined, e);
    throw new Error('Failed to decrypt value — no valid plaintext marker found', { cause: e });
  }
}
