import type { Context } from 'hono';

/** Escape special XML characters for safe inclusion in XML text content. */
export function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

/** Build an S3 XML error response with the given code, message, and HTTP status. */
export function xmlError(c: Context, code: string, message: string, status: number): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error>\n  <Code>${escapeXml(code)}</Code>\n  <Message>${escapeXml(message)}</Message>\n</Error>`;
  return c.text(xml, status as 400 | 401 | 403 | 404 | 405 | 409 | 500, { 'Content-Type': 'application/xml' });
}
