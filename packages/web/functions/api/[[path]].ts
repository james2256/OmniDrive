const DEFAULT_WORKER_ORIGIN = 'https://omnidrive-api.asmara-putra.workers.dev';

type PagesContext = {
  request: Request;
  env: { WORKER_URL?: string };
};

export function onRequest({ request, env }: PagesContext): Promise<Response> {
  const url = new URL(request.url);
  const workerOrigin = env.WORKER_URL || DEFAULT_WORKER_ORIGIN;
  return fetch(new Request(`${workerOrigin}${url.pathname}${url.search}`, request));
}
