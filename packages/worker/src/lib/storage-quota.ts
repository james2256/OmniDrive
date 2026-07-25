/** Google omits storageQuota.limit for unlimited accounts; use a practical ceiling for routing. */
export const UNLIMITED_DRIVE_QUOTA_BYTES = 1_099_511_627_776; // 1 TiB

/** Bumped when the cached quota shape or semantics change so stale KV entries are ignored. */
export const QUOTA_CACHE_VERSION = 2;

/**
 * `usage` covers the whole Google account (Drive + Gmail + Photos), which makes
 * per-drive storage read higher than the drive's actual usage. `usageInDrive`
 * is Drive-only, so prefer it and fall back to `usage` only when Google omits it
 * (e.g. some service-account shared folders).
 */
export function parseStorageQuota(
  limit?: string,
  usageInDrive?: string,
  usage?: string
): { total: number; used: number } {
  const used = parseInt(usageInDrive ?? usage ?? '0', 10);
  const total = limit != null && limit !== '' ? parseInt(limit, 10) : UNLIMITED_DRIVE_QUOTA_BYTES;
  return { total, used };
}

export function computeDriveQuota(
  stored: { totalQuota: number; usedQuota: number; quotaOverride?: number | null },
  live?: { total: number; used: number; hasLimit?: boolean } | null
): { totalQuota: number; usedQuota: number; freeSpace: number; usagePercent: number; hasLimit: boolean } {
  // User-set override wins for the total capacity, because Google's API
  // omits storageQuota.limit for Google Workspace pooled storage and service
  // accounts (it returns limit only "if applicable"). Without an override
  // those drives would always show the 1 TiB unlimited ceiling.
  const liveTotal = live?.total ?? 0;
  const hasLiveLimit = live?.hasLimit ?? (liveTotal > 0);
  const hasOverride = stored.quotaOverride != null && stored.quotaOverride > 0;

  // hasLimit signals the UI whether to show a progress bar (real limit known)
  // or "Pooled storage" (Google omitted the limit). It must NOT be true when
  // the total is just a stale stored.totalQuota fallback — only override or
  // a live Google-reported limit qualify.
  const hasLimit = hasOverride || hasLiveLimit;

  const overrideValue = stored.quotaOverride ?? 0;
  const total = hasOverride
    ? overrideValue
    : hasLiveLimit
      ? liveTotal
      : stored.totalQuota > 0
        ? stored.totalQuota
        : 0; // 0 = no limit known — UI shows "Pooled storage"

  const used = live?.used ?? stored.usedQuota;
  const effectiveTotal = total > 0 ? total : 0;
  const freeSpace = effectiveTotal > 0 ? Math.max(0, effectiveTotal - used) : 0;
  const usagePercent = effectiveTotal > 0 ? (used / effectiveTotal) * 100 : 0;
  return { totalQuota: effectiveTotal, usedQuota: used, freeSpace, usagePercent, hasLimit };
}