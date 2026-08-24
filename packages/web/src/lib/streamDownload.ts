/**
 * Streaming download layer — 3-tier fallback for writing the ZIP to disk
 * without buffering the entire archive in browser memory.
 *
 * Tier 1: Native File System Access API (showSaveFilePicker) — Chrome/Edge.
 *         Best UX (native Save As dialog, no service worker needed).
 * Tier 2: StreamSaver.js (service worker MITM) — Firefox/Safari desktop.
 *         Requires _headers X-Frame-Options: SAMEORIGIN (StreamSaver loads
 *         /mitm.html in an iframe; DENY blocks same-origin framing).
 * Tier 3: Legacy Blob path (mobile, or browsers without SW support).
 *         Memory-capped (~2GB on desktop, ~500MB on mobile).
 *
 * Choice is made via feature detection in getStreamMethod(). The caller
 * (FolderDownloadModal) calls openDownloadStream() IMMEDIATELY on the
 * "Download" button click to stay within the 5-second transient user
 * activation window required by showSaveFilePicker (MDN verified).
 */

// StreamSaver module + File System Access API types are declared in
// packages/web/src/vite-env.d.ts (streamsaver is untyped CJS; showSaveFilePicker
// isn't in lib.dom.d.ts yet).

import streamSaver from 'streamsaver';

// Self-host the MITM iframe + service worker instead of loading from
// https://jimmywarting.github.io/StreamSaver.js/mitm.html (third-party origin).
// Both must be served from the same origin as the page. Cloudflare Pages
// serves public/ at the root (per _routes.json), so /mitm.html and /sw.js
// resolve correctly. VITE_API_URL is empty (same-origin) — confirmed in
// packages/web/functions/_proxy.ts:14-19. Requires _headers:3 to be
// SAMEORIGIN — DENY blocks the iframe (verified via StreamSaver issue #203).
streamSaver.mitm = '/mitm.html';

export type StreamMethod = 'native' | 'streamsaver' | 'blob';

/**
 * Detect the best available streaming download method.
 *
 * 1. 'native'  — showSaveFilePicker (Chrome/Edge desktop). Best UX.
 * 2. 'streamsaver' — StreamSaver.js via service worker (Firefox/Safari desktop).
 *    Requires _headers X-Frame-Options: SAMEORIGIN (Phase 2 Item 0).
 * 3. 'blob'    — Legacy Blob path (mobile, or browsers without SW support).
 *
 * Mobile browsers are excluded from streaming — StreamSaver's SW doesn't
 * intercept downloads reliably on mobile (iOS Safari especially), and
 * showSaveFilePicker isn't supported on mobile either.
 */
export function getStreamMethod(): StreamMethod {
  if (typeof window === 'undefined') return 'blob';
  // Mobile detection — StreamSaver's service worker doesn't intercept downloads
  // reliably on mobile, and showSaveFilePicker isn't supported on mobile either.
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) return 'blob';
  // Native File System Access API — Chrome/Edge (74% of desktop users)
  if (typeof window.showSaveFilePicker === 'function') return 'native';
  // StreamSaver fallback — Firefox/Safari (24% of desktop users)
  if ('serviceWorker' in navigator && typeof WritableStream !== 'undefined') return 'streamsaver';
  return 'blob';
}

/**
 * Open a writable stream to disk for the folder ZIP. Called IMMEDIATELY on
 * "Download" button click to stay within the 5-second transient user
 * activation window required by showSaveFilePicker (MDN: "Transient user
 * activation is required").
 *
 * @returns The underlying WritableStream and the method used.
 * @throws AbortError if the user cancels the native Save As dialog.
 * @throws STREAMING_UNSUPPORTED if getStreamMethod() returns 'blob' —
 *         caller falls back to legacy Blob path.
 */
export async function openDownloadStream(
  filename: string,
  size?: number,
): Promise<{ writable: WritableStream<Uint8Array>; method: StreamMethod }> {
  const method = getStreamMethod();

  if (method === 'native') {
    // Chrome/Edge — native Save As picker (best UX, no service worker).
    // Must be called within 5s of user click (transient activation).
    // getStreamMethod() only returns 'native' when showSaveFilePicker exists,
    // but the type is optional — assert non-null with a runtime guard for safety.
    if (typeof window.showSaveFilePicker !== 'function') {
      throw new Error('showSaveFilePicker is not available');
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
    });
    const writable = await handle.createWritable();
    return { writable, method: 'native' };
  }

  if (method === 'streamsaver') {
    // Firefox/Safari — service worker MITM.
    const writable = streamSaver.createWriteStream(filename, { size });
    return { writable, method: 'streamsaver' };
  }

  // Mobile / unsupported — caller falls back to legacy Blob path.
  throw new Error('STREAMING_UNSUPPORTED');
}
