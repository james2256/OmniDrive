import { createMiddleware } from 'hono/factory';

/**
 * Generate or propagate a request ID for every request.
 *
 * - If the client sends `x-request-id`, reuse it (enables tracing across
 *   the Pages proxy → Worker hop).
 * - Otherwise generate a UUIDv4.
 * - Set on the response so the client can reference it in bug reports.
 * - Store on context so loggers can include it: c.get('requestId').
 */
export const requestId = createMiddleware<{
  Variables: { requestId: string };
}>(async (c, next) => {
  const id = c.req.header('x-request-id') || crypto.randomUUID();
  c.set('requestId', id);
  c.header('x-request-id', id);
  await next();
});
