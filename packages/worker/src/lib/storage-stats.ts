export interface FileStateForStats {
  size: number;
  mimeType: string; // caller COALESCEs NULL → ''
  isTrashed: boolean;
}

/**
 * Compute the (mime_type, delta) pairs to apply to file_storage_stats given
 * a state transition. Returns [] when the transition doesn't affect the
 * active (non-trashed) set — e.g. trashed→trashed, or delete of a trashed
 * file. Pure & synchronous; caller batches the resulting deltas.
 *
 * Rules (verified against the 9 possible transitions):
 *  insert active  → +new.size @ new.mime
 *  insert trashed → (none — not in active set)
 *  delete active  → -old.size @ old.mime
 *  delete trashed → (none)
 *  active→active, same mime → (new-old) @ mime
 *  active→active, diff mime → -old @ old.mime, +new @ new.mime
 *  trashed→active (restore / UPSERT untrashes) → +new @ new.mime
 *  active→trashed (trash)    → -old @ old.mime
 *  trashed→trashed           → (none)
 */
export function computeStorageDelta(
  oldState: FileStateForStats | null,
  newState: FileStateForStats | null,
): { mimeType: string; delta: number }[] {
  if (!oldState && !newState) return [];

  // Insert (no old state)
  if (!oldState) {
    if (!newState) return [];
    return newState.isTrashed ? [] : [{ mimeType: newState.mimeType, delta: newState.size }];
  }

  // Delete (no new state)
  if (!newState) {
    return oldState.isTrashed ? [] : [{ mimeType: oldState.mimeType, delta: -oldState.size }];
  }

  // Both present — it's an update
  if (oldState.isTrashed && newState.isTrashed) return []; // trashed→trashed

  if (oldState.isTrashed && !newState.isTrashed) {
    // trashed→active (restore or UPSERT untrashes)
    return [{ mimeType: newState.mimeType, delta: newState.size }];
  }

  if (!oldState.isTrashed && newState.isTrashed) {
    // active→trashed (trash)
    return [{ mimeType: oldState.mimeType, delta: -oldState.size }];
  }

  // active→active
  if (oldState.mimeType === newState.mimeType) {
    const diff = newState.size - oldState.size;
    return diff === 0 ? [] : [{ mimeType: newState.mimeType, delta: diff }];
  }

  // active→active, different mime type
  return [
    { mimeType: oldState.mimeType, delta: -oldState.size },
    { mimeType: newState.mimeType, delta: newState.size },
  ];
}
