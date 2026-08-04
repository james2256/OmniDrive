import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { escapeXml, xmlError, parseCompleteMultipartBody } from '../src/lib/s3-xml';

describe('escapeXml', () => {
  it('escapes <', () => {
    expect(escapeXml('a<b')).toBe('a&lt;b');
  });

  it('escapes >', () => {
    expect(escapeXml('a>b')).toBe('a&gt;b');
  });

  it('escapes &', () => {
    expect(escapeXml('a&b')).toBe('a&amp;b');
  });

  it("escapes '", () => {
    expect(escapeXml("a'b")).toBe('a&apos;b');
  });

  it('escapes "', () => {
    expect(escapeXml('a"b')).toBe('a&quot;b');
  });

  it('escapes all five special chars in one string', () => {
    expect(escapeXml(`<a href="x">O'Reilly & Sons</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;O&apos;Reilly &amp; Sons&lt;/a&gt;',
    );
  });

  it('returns input unchanged when no special chars present', () => {
    expect(escapeXml('plain text 123')).toBe('plain text 123');
  });

  it('escapes a string that is only special chars', () => {
    expect(escapeXml('<>&\'"')).toBe('&lt;&gt;&amp;&apos;&quot;');
  });

  it('does NOT escape non-ASCII or emoji (passes through)', () => {
    expect(escapeXml('héllo 🚀 世界')).toBe('héllo 🚀 世界');
  });

  it('escapes & first so output is XML-safe even when & precedes other specials', () => {
    // Verifies ordering: the source regex /[<>&'"]/g replaces per-match via switch,
    // so each char is independently escaped — '&lt; & amp;' ambiguity impossible.
    const input = '&<';
    const out = escapeXml(input);
    expect(out).toBe('&amp;&lt;');
    // And it should NOT produce a doubly-escaped '&amp;lt;'
    expect(out).not.toBe('&amp;lt;');
  });
});

describe('xmlError', () => {
  function buildApp() {
    const app = new Hono();
    app.get('/err', (c) => xmlError(c, 'NoSuchKey', 'The specified key does not exist.', 404));
    return app;
  }

  it('returns the given HTTP status code', async () => {
    const res = await buildApp().request('/err');
    expect(res.status).toBe(404);
  });

  it('sets Content-Type to application/xml', async () => {
    const res = await buildApp().request('/err');
    expect(res.headers.get('Content-Type')).toBe('application/xml');
  });

  it('body is a well-formed <Error> XML with <Code> and <Message>', async () => {
    const res = await buildApp().request('/err');
    const body = await res.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<Error xmlns="http://s3.amazonaws.com/doc/2006-03-01/">');
    expect(body).toContain('<Code>NoSuchKey</Code>');
    expect(body).toContain('<Message>The specified key does not exist.</Message>');
    expect(body).toContain('</Error>');
  });

  it('escapes the <Code> and <Message> values', async () => {
    const app = new Hono();
    app.get('/x', (c) =>
      xmlError(c, 'Code<With>&Specials"', 'Message with "quotes" & <tags>', 400),
    );
    const res = await app.request('/x');
    const body = await res.text();
    expect(body).toContain('<Code>Code&lt;With&gt;&amp;Specials&quot;</Code>');
    expect(body).toContain('<Message>Message with &quot;quotes&quot; &amp; &lt;tags&gt;</Message>');
    // And the unescaped forms must NOT be present (no raw injection)
    expect(body).not.toMatch(/<Code>Code<With>/);
    expect(body).not.toMatch(/<tags>/);
  });

  it('supports multiple status codes (400, 401, 403, 404, 405, 409, 500)', async () => {
    for (const status of [400, 401, 403, 404, 405, 409, 500]) {
      const app = new Hono();
      app.get('/x', (c) => xmlError(c, 'Code', 'msg', status));
      const res = await app.request('/x');
      expect(res.status).toBe(status);
      expect(res.headers.get('Content-Type')).toBe('application/xml');
    }
  });
});

describe('parseCompleteMultipartBody', () => {
  it('parses a standard aws-sdk body with namespace + XML declaration', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Part><ETag>"aaa111"</ETag><PartNumber>1</PartNumber></Part>
  <Part><ETag>"bbb222"</ETag><PartNumber>2</PartNumber></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts).toEqual([
      { partNumber: 1, etag: '"aaa111"' },
      { partNumber: 2, etag: '"bbb222"' },
    ]);
  });

  it('parses s3cmd body without namespace or XML declaration', () => {
    const xml = `<CompleteMultipartUpload>
<Part><PartNumber>1</PartNumber><ETag>"aaa"</ETag></Part>
<Part><PartNumber>2</PartNumber><ETag>"bbb"</ETag></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ partNumber: 1, etag: '"aaa"' });
  });

  it('returns empty array for empty body (lenient fallback signal)', () => {
    expect(parseCompleteMultipartBody('')).toEqual([]);
  });

  it('returns empty array for body with no <Part> elements', () => {
    const xml = `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/"></CompleteMultipartUpload>`;
    expect(parseCompleteMultipartBody(xml)).toEqual([]);
  });

  it('skips <Part> blocks missing <PartNumber> (lenient, not MalformedXML)', () => {
    const xml = `<CompleteMultipartUpload>
<Part><ETag>"aaa"</ETag></Part>
<Part><PartNumber>2</PartNumber><ETag>"bbb"</ETag></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ partNumber: 2, etag: '"bbb"' });
  });

  it('parses parts in any order (order validation is caller responsibility)', () => {
    const xml = `<CompleteMultipartUpload>
<Part><PartNumber>3</PartNumber><ETag>"ccc"</ETag></Part>
<Part><PartNumber>1</PartNumber><ETag>"aaa"</ETag></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts.map((p) => p.partNumber)).toEqual([3, 1]);
  });

  it('handles ETag without surrounding quotes', () => {
    const xml = `<CompleteMultipartUpload>
<Part><PartNumber>1</PartNumber><ETag>abc123</ETag></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts[0].etag).toBe('abc123');
  });

  it('is case-insensitive on tag names (handles <part> lowercase)', () => {
    const xml = `<CompleteMultipartUpload>
<part><partnumber>1</partnumber><etag>"x"</etag></part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts).toHaveLength(1);
    expect(parts[0].partNumber).toBe(1);
  });

  it('ignores <ChecksumSHA256> and other optional sibling elements', () => {
    const xml = `<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Part><ChecksumSHA256>deadbeef</ChecksumSHA256><ETag>"aaa"</ETag><PartNumber>1</PartNumber></Part>
</CompleteMultipartUpload>`;
    const parts = parseCompleteMultipartBody(xml);
    expect(parts).toEqual([{ partNumber: 1, etag: '"aaa"' }]);
  });
});
