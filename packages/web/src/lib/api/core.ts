export const API_BASE = import.meta.env.VITE_API_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, body.error ?? `HTTP ${response.status}`);
  }

  // 204 No Content has no body — return null instead of calling response.json()
  // (which would throw SyntaxError on the empty body).
  if (response.status === 204) return null as T;

  return response.json();
}

// 8MB chunk size. Google's guidance: "multiples of 256KB, as large as possible"
// (https://developers.google.com/drive/api/guides/manage-uploads#resumable).
// 8MB = 256KB × 32, a valid multiple. Community convention for reliability.
// Google's .NET client defaults to 10MB; we choose 8MB for finer-grained resume.
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Upload one chunk of a resumable upload via the Worker proxy.
 *
 * On success (2xx) returns `{ done: true, value }` with the file ID.
 * On 308 Resume Incomplete, parses the `Range` header to find the next
 * start byte and returns `{ done: false, nextStart }` so the caller can
 * slice the file and retry from that offset.
 *
 * Sends one 8MB chunk (or the remainder if < 8MB left). For files smaller
 * than 8MB, the whole file is sent in one chunk with zero-copy (passes `file`
 * directly instead of slicing, matching prior behavior).
 */
export function uploadChunk(
  url: string,
  file: File,
  start: number,
  onProgress?: (percent: number) => void,
): Promise<{ done: true; value: { id: string } } | { done: false; nextStart: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    // Send one 8MB chunk (or the remainder if < 8MB left).
    const end = Math.min(start + CHUNK_SIZE - 1, file.size - 1);
    // Preserve zero-copy for small files / first chunk (matches prior behavior).
    // Browsers optimize Blob.slice as a view, but passing the original File
    // when possible is still marginally cheaper and clearer in DevTools.
    const isWholeFile = start === 0 && end === file.size - 1;
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(Math.round(((start + e.loaded) / file.size) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.id) {
            resolve({ done: true, value: result });
          } else {
            reject(new Error('Upload response missing file ID'));
          }
        } catch {
          reject(
            new Error(`Upload response not valid JSON: ${xhr.responseText.substring(0, 100)}`),
          );
        }
      } else if (xhr.status === 308) {
        const range = xhr.getResponseHeader('Range') ?? '';
        const match = range.match(/bytes=0-(\d+)/);
        const nextStart = match ? parseInt(match[1], 10) + 1 : start + CHUNK_SIZE;
        resolve({ done: false, nextStart });
      } else {
        reject(
          new Error(`Upload proxy failed: ${xhr.status} - ${xhr.responseText.substring(0, 100)}`),
        );
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload network error')));
    xhr.open('PUT', `${API_BASE}/api/files/upload/proxy`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Upload-Url', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    if (file.size > 0) {
      xhr.setRequestHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    xhr.send(isWholeFile ? file : file.slice(start, end + 1));
  });
}

/**
 * Retry wrapper for uploadChunk. Mirrors the worker-side withBackoff pattern
 * (packages/worker/src/lib/backoff.ts:71). The frontend upload path uses
 * plain XMLHttpRequest with no built-in retry, so concurrent uploads (Fix 4)
 * need this safety net for transient 429s and network errors.
 *
 * Retries only on transient errors (429, 5xx, network errors) — not on 4xx
 * client errors (400/401/403/404) which won't succeed on retry. Mirrors the
 * worker's withBackoff error discrimination (backoff.ts:55-62).
 *
 * Exponential backoff: 1s, 2s, 4s. Max 3 attempts (1 initial + 2 retries).
 */
export async function uploadChunkWithRetry(
  url: string,
  file: File,
  start: number,
  onProgress?: (percent: number) => void,
  maxRetries = 2,
): Promise<{ done: true; value: { id: string } } | { done: false; nextStart: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await uploadChunk(url, file, start, onProgress);
    } catch (err) {
      if (attempt === maxRetries || !isRetryableUploadError(err)) throw err;
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.pow(2, attempt) * 1000;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error('unreachable');
}

/**
 * Determine if an upload error is worth retrying. Network errors, 429 (rate
 * limit), and 5xx (server errors) are transient. 4xx client errors (400/401/
 * 403/404) are not — retrying won't help. Mirrors worker's withBackoff logic.
 */
function isRetryableUploadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  // Network errors and 5xx/429 are retryable. 4xx (except 429) are not.
  return msg.includes('network error') || msg.includes('429') || /\b5\d\d\b/.test(msg);
}
