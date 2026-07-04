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

  // CSP — allow self + the frontend origin for cross-origin SPA fetch
  const frontendUrl = c.env?.FRONTEND_URL || '';
  const apiOrigin = frontendUrl ? new URL(frontendUrl).origin : '';
  const connectSrc = apiOrigin && apiOrigin !== new URL(c.req.url).origin
    ? `'self' ${apiOrigin}`
    : "'self'";
  c.header(
    'Content-Security-Policy',
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src ${connectSrc}; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`
  );
});
