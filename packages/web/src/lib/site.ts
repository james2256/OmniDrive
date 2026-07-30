/**
 * Canonical public URL of the deployed site (no trailing slash).
 *
 * Set `VITE_PUBLIC_URL` in .env (dev) or Cloudflare Pages → Settings →
 * Environment variables (prod). Falls back to localhost if unset.
 * Throws if set but not a valid http(s) URL.
 */
const raw = import.meta.env.VITE_PUBLIC_URL;

if (raw && !/^https?:\/\//.test(raw)) {
  throw new Error('VITE_PUBLIC_URL is set but not a valid http(s) URL: ' + raw);
}

export const PUBLIC_URL: string = (raw || 'http://localhost:8999').replace(/\/+$/, '');
