-- Separate composite S3-style ETags from the true-MD5 metadata key.
--
-- Background: multipart uploads stored the composite ETag (`<md5>-<partCount>`)
-- under the same `metadata.md5` key that single-PUT uploads use for the true
-- 32-hex MD5. The single reader (getFileETag) could not tell the shapes apart,
-- so it emitted composites for multipart files and true MD5s for single-PUT
-- files interchangeably under the same key.
--
-- This migration moves every composite-shaped value out of `md5` into a
-- dedicated `s3Etag` key. True 32-hex MD5s, uppercase, numeric, malformed, NULL,
-- and array rows are all left untouched (the WHERE guard only matches
-- `<32 lowercase hex chars>-<digits>`, which no true MD5 or post-migration
-- row can satisfy). Idempotent — re-running matches zero rows.
--
-- No schema change: `s3Etag` lives inside the existing `metadata` JSON column.
-- Code-first deploy is safe: the new getFileETag reads `s3Etag ?? md5`, so
-- pre-migration rows (composite still under `md5`) serve correctly until the
-- migration runs, and post-migration rows (composite under `s3Etag`) serve
-- correctly afterward.
UPDATE files
SET metadata = json_patch(
  json_remove(metadata, '$.md5'),
  json_object('s3Etag', json_extract(metadata, '$.md5'))
)
WHERE json_valid(metadata)
  AND json_type(metadata, '$.md5') = 'text'
  AND json_extract(metadata, '$.md5') GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9]*';
