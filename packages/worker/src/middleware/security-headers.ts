import { createMiddleware } from 'hono/factory';

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '0'); // ponytail: modern browsers ignore the old mode=block; 0 is the current recommendation
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS — only meaningful over HTTPS
  const isHttps = c.req.url.startsWith('https://');
  if (isHttps) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // API responses are JSON/XML only — tight CSP; SPA security headers live in Pages `_headers`
  const frontendUrl = c.env?.FRONTEND_URL || '';
  const apiOrigin = frontendUrl ? new URL(frontendUrl).origin : '';
  const connectSrc = apiOrigin && apiOrigin !== new URL(c.req.url).origin
    ? `'self' ${apiOrigin}`
    : "'self'";
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; connect-src ${connectSrc}`
  );
});
