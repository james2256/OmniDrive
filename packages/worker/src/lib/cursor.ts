export function encodeCursor<T>(payload: T): string {
  const str = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  const base64 = btoa(binString);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T | null {
  try {
    let base64 = cursor.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const binString = atob(base64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    const str = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(str);
    // Reject null/undefined — a cursor must be a JSON value (object or array).
    // Crafted input that decodes to null is treated as "no cursor" (pagination
    // starts from beginning) rather than passing null to SQL parameters.
    return parsed === null ? null : (parsed as T);
  } catch {
    return null;
  }
}
