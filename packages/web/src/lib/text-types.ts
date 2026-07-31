/**
 * MIME types under `application/*` that are text-based and should be previewed
 * as text in a `<pre>` block. These don't match `text/*` but are human-readable
 * source/config files.
 *
 * Shared between the worker (isPreviewableMime gate) and the web (isText flag)
 * so both sides agree on which application/* types are text-previewable.
 */
export const TEXT_APPLICATION_TYPES = new Set([
  'application/json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/rtf',
  'application/x-sh',
  'application/x-php',
]);
