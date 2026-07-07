// ponytail: PBKDF2 via Web Crypto — bcrypt (cost ≥ 10) times out on Workers CPU limit.
// ponytail: 10k iterations — 100k exceeds Workers CPU limit (~50ms); 10k is fast enough for web auth, upgrade if Workers raises CPU ceiling
const ITERATIONS = 10_000;
const LEGACY_SHARED_ITERATIONS = 100_000;
const SALT_BYTES = 16;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    key,
    256,
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `pbkdf2:${ITERATIONS}:${saltB64}:${hashB64}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iters, saltB64, hashB64] = parts;
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: parseInt(iters, 10) },
    key,
    256,
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return timingSafeEqual(computed, hashB64);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array | null {
  const match = hex.match(/.{1,2}/g);
  if (!match) return null;
  return new Uint8Array(match.map((byte) => parseInt(byte, 16)));
}

async function derivePbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

/** Shared-link passwords: new hashes use 10k iterations (Workers CPU safe). */
export async function hashSharedPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hashHex = await derivePbkdf2Hex(password, salt, ITERATIONS);
  return `shared:${ITERATIONS}:${bytesToHex(salt)}:${hashHex}`;
}

/**
 * Verifies shared-link passwords. Supports:
 * - New format: shared:<iterations>:<saltHex>:<hashHex>
 * - Legacy format: <saltHex>:<hashHex> (implicit 100k iterations)
 */
export async function verifySharedPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  let iterations: number;
  let saltHex: string;
  let storedHashHex: string;

  if (parts.length === 4 && parts[0] === 'shared') {
    iterations = parseInt(parts[1], 10);
    saltHex = parts[2];
    storedHashHex = parts[3];
  } else if (parts.length === 2) {
    iterations = LEGACY_SHARED_ITERATIONS;
    saltHex = parts[0];
    storedHashHex = parts[1];
  } else {
    return false;
  }

  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = hexToBytes(saltHex);
  if (!salt) return false;

  const hashHex = await derivePbkdf2Hex(password, salt, iterations);
  return timingSafeEqual(hashHex, storedHashHex);
}
