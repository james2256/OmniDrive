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

/**
 * Upload one chunk of a resumable upload via the Worker proxy.
 *
 * On success (2xx) returns `{ done: true, value }` with the file ID.
 * On 308 Resume Incomplete, parses the `Range` header to find the next
 * start byte and returns `{ done: false, nextStart }` so the caller can
 * slice the file and retry from that offset.
 */
export function uploadChunk(
  url: string,
  file: File,
  start: number,
  onProgress?: (percent: number) => void,
): Promise<{ done: true; value: { id: string } } | { done: false; nextStart: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const end = file.size - 1;
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
        const nextStart = match ? parseInt(match[1], 10) + 1 : 0;
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
    xhr.send(start > 0 ? file.slice(start) : file);
  });
}
