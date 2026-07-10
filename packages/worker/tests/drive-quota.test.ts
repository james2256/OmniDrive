import { describe, it, expect } from 'vitest';
import { parseStorageQuota, computeDriveQuota, UNLIMITED_DRIVE_QUOTA_BYTES } from '../src/lib/storage-quota';

describe('parseStorageQuota', () => {
  it('parses limited quota from Google response', () => {
    expect(parseStorageQuota('16106127360', '1073741824', '5368709120')).toEqual({
      total: 16106127360,
      used: 1073741824,
    });
  });

  it('prefers usageInDrive over account-wide usage', () => {
    // usage includes Gmail + Photos; only usageInDrive reflects Drive bytes
    expect(parseStorageQuota('16106127360', '1073741824', '5368709120')).toEqual({
      total: 16106127360,
      used: 1073741824,
    });
  });

  it('falls back to account-wide usage when usageInDrive is missing', () => {
    expect(parseStorageQuota('16106127360', undefined, '5368709120')).toEqual({
      total: 16106127360,
      used: 5368709120,
    });
  });

  it('treats missing limit as unlimited storage', () => {
    expect(parseStorageQuota(undefined, undefined, '5000')).toEqual({
      total: UNLIMITED_DRIVE_QUOTA_BYTES,
      used: 5000,
    });
  });
});

describe('computeDriveQuota', () => {
  it('uses live quota when available', () => {
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 0 }, { total: 1000, used: 200 })).toEqual({
      totalQuota: 1000,
      usedQuota: 200,
      freeSpace: 800,
      usagePercent: 20,
    });
  });

  it('treats unknown stored quota as unlimited for upload routing', () => {
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 0 })).toEqual({
      totalQuota: UNLIMITED_DRIVE_QUOTA_BYTES,
      usedQuota: 0,
      freeSpace: UNLIMITED_DRIVE_QUOTA_BYTES,
      usagePercent: 0,
    });
  });

  it('quotaOverride wins over live limit and the unlimited fallback', () => {
    // Google Workspace 5 TiB pool: Google omits limit, user sets override to 5 TiB
    const fiveTib = 5 * 1024 ** 4;
    expect(computeDriveQuota({ totalQuota: 0, usedQuota: 0, quotaOverride: fiveTib }, { total: UNLIMITED_DRIVE_QUOTA_BYTES, used: 200 })).toEqual({
      totalQuota: fiveTib,
      usedQuota: 200,
      freeSpace: fiveTib - 200,
      usagePercent: (200 / fiveTib) * 100,
    });
  });

  it('falls back to stored total when Google omits limit and no override', () => {
    // Caller passes total: 0 when Google did not report a limit.
    expect(computeDriveQuota({ totalQuota: 5000, usedQuota: 1000 }, { total: 0, used: 1000 })).toEqual({
      totalQuota: 5000,
      usedQuota: 1000,
      freeSpace: 4000,
      usagePercent: 20,
    });
  });
});