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
  live?: { total: number; used: number } | null
): { totalQuota: number; usedQuota: number; freeSpace: number; usagePercent: number } {
  // User-set override wins for the total capacity, because Google's API
  // omits storageQuota.limit for Google Workspace pooled storage and service
  // accounts (it returns limit only "if applicable"). Without an override
  // those drives would always show the 1 TiB unlimited ceiling.
  const liveTotal = live?.total ?? 0;
  const hasLiveLimit = liveTotal > 0;
  const total =
    stored.quotaOverride && stored.quotaOverride > 0
      ? stored.quotaOverride
      : hasLiveLimit
        ? liveTotal
        : stored.totalQuota > 0
          ? stored.totalQuota
          : UNLIMITED_DRIVE_QUOTA_BYTES;
  const used = live?.used ?? stored.usedQuota;
  const effectiveTotal = total > 0 ? total : UNLIMITED_DRIVE_QUOTA_BYTES;
  const freeSpace = Math.max(0, effectiveTotal - used);
  const usagePercent = effectiveTotal > 0 ? (used / effectiveTotal) * 100 : 0;
  return { totalQuota: effectiveTotal, usedQuota: used, freeSpace, usagePercent };
}