export interface FileStateForStats {
  size: number;
  mimeType: string; // caller COALESCEs NULL → ''
  isTrashed: boolean;
  ownedByMe: boolean;
}

/**
 * Compute the (mime_type, delta) pairs to apply to file_storage_stats given
 * a state transition. Returns [] when the transition doesn't affect the
 * active (non-trashed) owned set.
 *
 * Ownership-aware (Approach B): considers `ownedByMe` as a dimension of the
 * state, not just a gate. Handles both ownership-transfer directions:
 * - Owned → non-owned: treats as delete (fires -size)
 * - Non-owned → owned: treats as insert (fires +size)
 * - Non-owned → non-owned: no quota impact
 *
 * Rules (verified against all edge cases):
 *  insert active (owned)     → +new.size @ new.mime
 *  insert trashed (owned)    → (none — not in active set)
 *  delete active (owned)     → -old.size @ old.mime
 *  delete trashed (owned)    → (none)
 *  active→active, same mime  → (new-old) @ mime
 *  active→active, diff mime  → -old @ old.mime, +new @ new.mime
 *  trashed→active (owned)    → +new @ new.mime
 *  active→trashed (owned)    → -old @ old.mime
 *  trashed→trashed           → (none)
 *  owned→non-owned            → -old.size @ old.mime (if active)
 *  non-owned→owned            → +new.size @ new.mime (if active)
 *  non-owned→non-owned         → (none)
 */
export function computeStorageDelta(
  oldState: FileStateForStats | null,
  newState: FileStateForStats | null,
): { mimeType: string; delta: number }[] {
  const oldInQuota = oldState?.ownedByMe ?? false;
  const newInQuota = newState?.ownedByMe ?? false;

  // Non-owned → non-owned: no quota impact
  if (!oldInQuota && !newInQuota) return [];

  // Non-owned → owned: treat as insert (reverse ownership transfer → +size)
  if (!oldInQuota && newInQuota) {
    if (!newState) return [];
    return newState.isTrashed ? [] : [{ mimeType: newState.mimeType, delta: newState.size }];
  }

  // Owned → non-owned: treat as delete (forward ownership transfer → -size)
  if (oldInQuota && !newInQuota) {
    if (!oldState) return [];
    return oldState.isTrashed ? [] : [{ mimeType: oldState.mimeType, delta: -oldState.size }];
  }

  // Both owned (or both null with at least one in quota) — existing logic
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
