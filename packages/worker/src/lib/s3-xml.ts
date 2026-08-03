import type { Context } from 'hono';

/** Escape special XML characters for safe inclusion in XML text content. */
export function escapeXml(str: string): string {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

/** S3 XML namespace required by strict clients (boto3, aws-sdk-go, rclone). */
const S3_XMLNS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';

export interface ParsedCompletePart {
  partNumber: number;
  etag: string;
}

/**
 * Parse the &lt;CompleteMultipartUpload&gt; XML body sent by S3 clients.
 *
 * Extracts &lt;Part&gt;&lt;PartNumber&gt;N&lt;/PartNumber&gt;&lt;ETag&gt;"..."&lt;/ETag&gt;&lt;/Part&gt; entries.
 * Returns an empty array if the body is empty or contains no &lt;Part&gt; elements —
 * callers should treat an empty result as "use all stored parts" (lenient fallback).
 *
 * Uses regex (not DOMParser) because Cloudflare Workers do not expose DOMParser.
 * The S3 CompleteMultipartUpload XML is simple enough that regex is safe here.
 */
export function parseCompleteMultipartBody(xml: string): ParsedCompletePart[] {
  const parts: ParsedCompletePart[] = [];
  for (const m of xml.matchAll(/<Part\b[^>]*>([\s\S]*?)<\/Part>/gi)) {
    const block = m[1];
    const numStr = block.match(/<PartNumber\b[^>]*>\s*(\d+)\s*<\/PartNumber>/i)?.[1];
    if (!numStr) continue;
    const etag = (block.match(/<ETag\b[^>]*>\s*(.*?)\s*<\/ETag>/i)?.[1] ?? '').trim();
    parts.push({ partNumber: parseInt(numStr, 10), etag });
  }
  return parts;
}

/** Build an S3 XML error response with the given code, message, and HTTP status. */
export function xmlError(c: Context, code: string, message: string, status: number): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Error ${S3_XMLNS}>\n  <Code>${escapeXml(code)}</Code>\n  <Message>${escapeXml(message)}</Message>\n</Error>`;
  return c.text(xml, status as 400 | 401 | 403 | 404 | 405 | 409 | 500, {
    'Content-Type': 'application/xml',
  });
}
