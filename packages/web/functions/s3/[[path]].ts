type PagesContext = {
  request: Request;
  env: { WORKER_URL?: string };
};

export function onRequest({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const workerOrigin = env.WORKER_URL;
  if (!workerOrigin) {
    return Promise.resolve(
      new Response(
        'WORKER_URL env var not set on Cloudflare Pages project.\n' +
          'Set it in: Pages → Settings → Environment variables → WORKER_URL\n' +
          'Example: https://your-worker-name.your-subdomain.workers.dev',
        { status: 500, headers: { 'Content-Type': 'text/plain' } },
      ),
    );
  }
  return fetch(new Request(`${workerOrigin}${url.pathname}${url.search}`, request));
}
