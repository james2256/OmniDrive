-- Add content_type column to s3_multipart_uploads so CompleteMultipart
-- can preserve the MIME type from the Initiate request. Previously
-- hardcoded to 'application/octet-stream', which broke FileIcon fallback
-- and prevented Google from generating thumbnails (Google stores the MIME
-- from X-Upload-Content-Type header, so the final concat upload must use
-- the correct MIME too).
ALTER TABLE s3_multipart_uploads ADD COLUMN content_type TEXT;
