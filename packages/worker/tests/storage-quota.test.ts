import { describe, it, expect } from 'vitest';
import {
  parseStorageQuota,
  computeDriveQuota,
  UNLIMITED_DRIVE_QUOTA_BYTES,
  QUOTA_CACHE_VERSION,
} from '../src/lib/storage-quota';

describe('module constants', () => {
  it('UNLIMITED_DRIVE_QUOTA_BYTES is 1 TiB', () => {
    expect(UNLIMITED_DRIVE_QUOTA_BYTES).toBe(1_099_511_627_776);
    expect(UNLIMITED_DRIVE_QUOTA_BYTES).toBe(1024 ** 4);
  });

  it('QUOTA_CACHE_VERSION is a positive integer', () => {
    expect(QUOTA_CACHE_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(QUOTA_CACHE_VERSION)).toBe(true);
  });
});

describe('parseStorageQuota', () => {
  it('parses limit + usageInDrive + usage from strings', () => {
    expect(parseStorageQuota('1000', '500', '999')).toEqual({ total: 1000, used: 500 });
  });

  it('prefers usageInDrive over usage when both provided', () => {
    expect(parseStorageQuota('1000', '500', '999')).toEqual({ total: 1000, used: 500 });
  });

  it('falls back to account-wide usage when usageInDrive missing', () => {
    expect(parseStorageQuota('1000', undefined, '999')).toEqual({ total: 1000, used: 999 });
  });

  it('treats missing limit as UNLIMITED_DRIVE_QUOTA_BYTES', () => {
    expect(parseStorageQuota(undefined, '100', undefined)).toEqual({
      total: UNLIMITED_DRIVE_QUOTA_BYTES,
      used: 100,
    });
  });

  it('treats empty string limit as unlimited (NOT as 0)', () => {
    // Source: `limit != null && limit !== ''` — empty string is the "no limit" branch
    expect(parseStorageQuota('', '100', undefined)).toEqual({
      total: UNLIMITED_DRIVE_QUOTA_BYTES,
      used: 100,
    });
  });

  it('falls back to 0 used when both usage values are missing', () => {
    expect(parseStorageQuota('1000', undefined, undefined)).toEqual({
      total: 1000,
      used: 0,
    });
  });

  it('parses all-undefined as { unlimited, 0 }', () => {
    expect(parseStorageQuota()).toEqual({
      total: UNLIMITED_DRIVE_QUOTA_BYTES,
      used: 0,
    });
  });

  it('treats "0" limit as a real zero limit (NOT unlimited)', () => {
    // "0" passes the `limit !== ''` check, so it's parsed as 0 (a real limit)
    expect(parseStorageQuota('0', '10', undefined)).toEqual({ total: 0, used: 10 });
  });

  it('handles large integer string values (TiB range)', () => {
    const oneTib = String(UNLIMITED_DRIVE_QUOTA_BYTES);
    expect(parseStorageQuota(oneTib, '100', undefined)).toEqual({
      total: UNLIMITED_DRIVE_QUOTA_BYTES,
      used: 100,
    });
  });
});

describe('computeDriveQuota', () => {
  it('uses live quota when provided (and signals hasLimit=true)', () => {
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 0 }, { total: 1000, used: 200 })).toEqual({
      totalQuota: 1000,
      usedQuota: 200,
      freeSpace: 800,
      usagePercent: 20,
      hasLimit: true,
    });
  });

  it('returns hasLimit=false when no limit is known (pooled storage)', () => {
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 0 })).toEqual({
      totalQuota: 0,
      usedQuota: 0,
      freeSpace: 0,
      usagePercent: 0,
      hasLimit: false,
    });
  });

  it('quotaOverride wins over live total when override > 0', () => {
    const fiveTib = 5 * 1024 ** 4;
    expect(
      computeDriveQuota(
        { totalQuota: 0, usedQuota: 0, quotaOverride: fiveTib },
        { total: UNLIMITED_DRIVE_QUOTA_BYTES, used: 200 },
      ),
    ).toEqual({
      totalQuota: fiveTib,
      usedQuota: 200,
      freeSpace: fiveTib - 200,
      usagePercent: (200 / fiveTib) * 100,
      hasLimit: true,
    });
  });

  it('quotaOverride = 0 is NOT treated as an override (falls through to live / stored)', () => {
    // Source: `quotaOverride != null && quotaOverride > 0` — 0 fails the check
    expect(
      computeDriveQuota(
        { totalQuota: 0, usedQuota: 0, quotaOverride: 0 },
        { total: 5000, used: 100 },
      ),
    ).toEqual({
      totalQuota: 5000,
      usedQuota: 100,
      freeSpace: 4900,
      usagePercent: 2,
      hasLimit: true,
    });
  });

  it('quotaOverride = null is NOT treated as an override', () => {
    expect(
      computeDriveQuota(
        { totalQuota: 0, usedQuota: 0, quotaOverride: null },
        { total: 5000, used: 100 },
      ),
    ).toEqual({
      totalQuota: 5000,
      usedQuota: 100,
      freeSpace: 4900,
      usagePercent: 2,
      hasLimit: true,
    });
  });

  it('falls back to stored.totalQuota when Google omits limit (live.total = 0) and no override', () => {
    // live.total = 0 → hasLiveLimit = false → falls to stored.totalQuota (>0)
    // BUT hasLimit is still false (no override, no live limit)
    expect(
      computeDriveQuota({ totalQuota: 5000, usedQuota: 1000 }, { total: 0, used: 1000 }),
    ).toEqual({
      totalQuota: 5000,
      usedQuota: 1000,
      freeSpace: 4000,
      usagePercent: 20,
      hasLimit: false,
    });
  });

  it('live.hasLimit=true forces hasLimit=true even when live.total is 0', () => {
    // Edge case: caller explicitly signals Google reported a limit even if total is 0
    expect(
      computeDriveQuota(
        { totalQuota: 5000, usedQuota: 1000 },
        { total: 0, used: 1000, hasLimit: true },
      ),
    ).toEqual({
      totalQuota: 0, // hasLiveLimit true → uses liveTotal (0)
      usedQuota: 1000,
      freeSpace: 0, // effectiveTotal 0 → freeSpace 0
      usagePercent: 0,
      hasLimit: true,
    });
  });

  it('live.hasLimit=false suppresses hasLimit even when live.total > 0 (Google omitted limit)', () => {
    // hasLiveLimit=false → falls through to stored.totalQuota branch
    // stored.totalQuota=0 → total=0 → effectiveTotal=0 → freeSpace=0, usagePercent=0
    expect(
      computeDriveQuota(
        { totalQuota: 0, usedQuota: 0 },
        { total: 5000, used: 100, hasLimit: false },
      ),
    ).toEqual({
      totalQuota: 0,
      usedQuota: 100,
      freeSpace: 0,
      usagePercent: 0,
      hasLimit: false,
    });
  });

  it('uses stored.usedQuota when live.used missing', () => {
    expect(computeDriveQuota({ totalQuota: 5000, usedQuota: 250 }, { total: 5000 })).toEqual({
      totalQuota: 5000,
      usedQuota: 250,
      freeSpace: 4750,
      usagePercent: 5,
      hasLimit: true,
    });
  });

  it('clamps freeSpace to 0 when used exceeds total (no negative)', () => {
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 200 }, { total: 100, used: 200 })).toEqual(
      {
        totalQuota: 100,
        usedQuota: 200,
        freeSpace: 0,
        usagePercent: 200,
        hasLimit: true,
      },
    );
  });

  it('live=null defers entirely to stored (used = stored.usedQuota, total = stored.totalQuota)', () => {
    expect(computeDriveQuota({ totalQuota: 3000, usedQuota: 1500 }, null)).toEqual({
      totalQuota: 3000,
      usedQuota: 1500,
      freeSpace: 1500,
      usagePercent: 50,
      hasLimit: false, // stored total alone does NOT make hasLimit true
    });
  });
});
