/**
 * Creates a TransformStream that counts bytes passing through and invokes
 * the onProgress callback. Inserted between the ZIP ReadableStream and the
 * disk WritableStream to report byte-level download progress.
 *
 * Pattern prescribed by StreamSaver maintainer (issue #152):
 * "var progress = new TransformStream({ transform(chunk, controller) {
 *    loaded += chunk.length; controller.enqueue(chunk); } })"
 *
 * Throttled to max once per 250ms to avoid React re-render storms (500 small
 * files would otherwise trigger 500 state updates per second).
 */
export function createProgressStream(
  totalSize: number,
  onProgress: (bytesWritten: number) => void,
): TransformStream<Uint8Array, Uint8Array> {
  let bytesWritten = 0;
  let lastReport = 0;
  return new TransformStream({
    transform(chunk, controller) {
      bytesWritten += chunk.length;
      const now = Date.now();
      // Throttle: report at most every 250ms, plus the final chunk.
      if (now - lastReport >= 250 || bytesWritten >= totalSize) {
        lastReport = now;
        onProgress(bytesWritten);
      }
      controller.enqueue(chunk);
    },
  });
}
