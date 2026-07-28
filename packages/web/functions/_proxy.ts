/**
 * Same-origin proxy: forwards the request to the Worker's WORKER_URL.
 * Used by /api/* and /s3/* Pages Functions (see ADR-0006).
 *
 * WORKER_URL must be set as a Pages environment variable
 * (Cloudflare dashboard → Pages → Settings → Environment variables).
 * Returns 502 if unset — no silent fallback.
 */
type PagesContext = {
  request: Request;
  env: { WORKER_URL?: string };
};

export function proxyToWorker({ request, env }: PagesContext): Promise<Response> {
  if (!env.WORKER_URL) {
    return Promise.resolve(new Response('WORKER_URL env var is not set on Pages', { status: 502 }));
  }
  const url = new URL(request.url);
  return fetch(new Request(`${env.WORKER_URL}${url.pathname}${url.search}`, request));
}
