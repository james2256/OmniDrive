/**
 * SigV4 signing helper for S3 integration tests.
 *
 * Generates AWS Signature Version 4 headers so test requests pass the
 * s3AuthMiddleware. Mirrors the calculateSigV4 in tests/s3-api.test.ts
 * but lives in a shared module so integration tests can reuse it.
 */
import { hmacSha256, sha256 } from '../../src/lib/crypto-s3';

export interface SigV4Params {
  method: string;
  path: string;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  payload?: string;
  accessKeyId?: string;
  secretAccessKey: string;
  region?: string;
  service?: string;
  dateStr?: string;
  amzDate?: string;
}

export function calculateSigV4({
  method,
  path,
  queryParams = {},
  headers = {},
  payload = '',
  accessKeyId: _accessKeyId = 'test-access-key',
  secretAccessKey,
  region = 'us-east-1',
  service = 's3',
  dateStr = '20260621',
  amzDate = '20260621T120000Z',
}: SigV4Params) {
  function awsEncode(str: string): string {
    return encodeURIComponent(str)
      .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  const queryParamsList: [string, string][] = Object.entries(queryParams);
  queryParamsList.sort((a, b) => {
    const aKey = awsEncode(a[0]);
    const bKey = awsEncode(b[0]);
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    const aVal = awsEncode(a[1]);
    const bVal = awsEncode(b[1]);
    if (aVal < bVal) return -1;
    if (aVal > bVal) return 1;
    return 0;
  });
  const canonicalQueryString = queryParamsList
    .map(([key, val]) => `${awsEncode(key)}=${awsEncode(val)}`)
    .join('&');

  const canonicalHeadersList = Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]);
  canonicalHeadersList.sort((a, b) => {
    const aKey = a[0];
    const bKey = b[0];
    if (aKey < bKey) return -1;
    if (aKey > bKey) return 1;
    return 0;
  });
  const canonicalHeaders = canonicalHeadersList
    .map(([k, v]) => `${k}:${v.trim().replace(/\s+/g, ' ')}\n`)
    .join('');

  const signedHeaders = canonicalHeadersList.map(([k]) => k).join(';');
  const payloadHash = headers['x-amz-content-sha256'] || sha256(payload);

  const canonicalRequest = [
    method,
    path,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    `${dateStr}/${region}/${service}/aws4_request`,
    sha256(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256('AWS4' + secretAccessKey, dateStr);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  return { signature, signedHeaders };
}

export function buildAuthHeader(accessKeyId: string, dateStr: string, signedHeaders: string, signature: string): string {
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${dateStr}/us-east-1/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
