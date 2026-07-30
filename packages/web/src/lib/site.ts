/**
 * Canonical public URL of the deployed site (no trailing slash).
 *
 * Set `VITE_PUBLIC_URL` in .env (dev) or Cloudflare Pages → Settings →
 * Environment variables (prod). Build fails fast if missing/invalid.
 */
const raw = import.meta.env.VITE_PUBLIC_URL;

if (!raw || !/^https?:\/\//.test(raw)) {
  throw new Error(
    'VITE_PUBLIC_URL is missing or not a valid http(s) URL. ' +
      'Set it in .env (dev) or Cloudflare Pages env vars (prod).',
  );
}

export const PUBLIC_URL: string = raw.replace(/\/+$/, '');
