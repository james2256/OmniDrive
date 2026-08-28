import { describe, it, expect } from 'vitest';
import { UploadRouter } from '../src/services/upload-router';
import type { DriveWithQuota } from '../src/types';

describe('UploadRouter', () => {
  const limitedDrives: DriveWithQuota[] = [
    {
      id: 'drive1',
      userId: 'user1',
      googleAccountId: 'g1',
      email: 'a@gmail.com',
      name: 'Drive A',
      type: 'oauth',
      isPrimary: true,
      rootFolderId: null,
      totalQuota: 1000,
      usedQuota: 800,
      quotaOverride: null,
      quotaUpdatedAt: null,
      syncStatus: 'idle',
      syncErrorMessage: null,
      syncPaused: false,
      lastSyncedAt: null,
      freeSpace: 200,
      usagePercent: 80,
      hasLimit: true,
      isUnlimited: false,
      createdAt: '',
    },
    {
      id: 'drive2',
      userId: 'user1',
      googleAccountId: 'g2',
      email: 'b@gmail.com',
      name: 'Drive B',
      type: 'oauth',
      isPrimary: false,
      rootFolderId: null,
      totalQuota: 1000,
      usedQuota: 400,
      quotaOverride: null,
      quotaUpdatedAt: null,
      syncStatus: 'idle',
      syncErrorMessage: null,
      syncPaused: false,
      lastSyncedAt: null,
      freeSpace: 600,
      usagePercent: 40,
      hasLimit: true,
      isUnlimited: false,
      createdAt: '',
    },
  ];

  it('selects the drive with the most free space when no preference is given', () => {
    const router = new UploadRouter(limitedDrives);
    const selected = router.selectDriveForUpload(100);
    expect(selected.id).toBe('drive2');
  });

  it('respects preferredDriveId if provided and has enough space', () => {
    const router = new UploadRouter(limitedDrives);
    const selected = router.selectDriveForUpload(100, 'drive1');
    expect(selected.id).toBe('drive1');
  });

  it('spills over to the most-free drive when preferredDriveId is full', () => {
    const router = new UploadRouter(limitedDrives);
    // drive1 has 200 free (too small for 300), spill over to drive2 (600 free)
    const selected = router.selectDriveForUpload(300, 'drive1');
    expect(selected.id).toBe('drive2');
  });

  it('throws if preferred is full and no drive fits', () => {
    const router = new UploadRouter(limitedDrives);
    expect(() => router.selectDriveForUpload(700, 'drive1')).toThrowError(
      'Insufficient overall quota for this file',
    );
  });

  it('throws if all drives are full', () => {
    const router = new UploadRouter(limitedDrives);
    expect(() => router.selectDriveForUpload(700)).toThrowError(
      'Insufficient overall quota for this file',
    );
  });

  // ─── A-6b provenance + A-1 comparator (the flagship fix) ───

  it('sorts unlimited drives first (operand swap prevents inversion)', () => {
    // A pooled drive (isUnlimited=true, freeSpace=0) alongside a limited drive
    // (isUnlimited=false, freeSpace=14GB). The corrected comparator must put
    // the unlimited drive at sorted[0] — the inverted form would sort it last.
    const drives: DriveWithQuota[] = [
      { ...limitedDrives[0], freeSpace: 14 * 1024 ** 3, isUnlimited: false },
      { ...limitedDrives[1], id: 'pooled', freeSpace: 0, isUnlimited: true },
    ];
    const router = new UploadRouter(drives);
    const selected = router.selectDriveForUpload(20 * 1024 ** 3);
    expect(selected.id).toBe('pooled'); // unlimited drive selected
  });

  it('an unlimited drive always fits any upload size', () => {
    const drives: DriveWithQuota[] = [
      { ...limitedDrives[1], id: 'pooled', freeSpace: 0, isUnlimited: true },
    ];
    const router = new UploadRouter(drives);
    // 20GB on a drive with freeSpace=0 — fits because isUnlimited=true
    const selected = router.selectDriveForUpload(20 * 1024 ** 3);
    expect(selected.id).toBe('pooled');
  });

  it('excludes unconfirmed drives from auto-selection (provenance)', () => {
    // A stored-only drive (no live data → isUnlimited=false, freeSpace=0) must
    // NOT be treated as unlimited — routing a 20GB upload onto it would risk
    // a silent quota violation (A-6b). It's excluded from auto-selection.
    const drives: DriveWithQuota[] = [
      { ...limitedDrives[1], id: 'unconfirmed', freeSpace: 0, isUnlimited: false },
    ];
    const router = new UploadRouter(drives);
    expect(() => router.selectDriveForUpload(20 * 1024 ** 3)).toThrowError(
      'Insufficient overall quota for this file',
    );
  });

  it('does not over-accept on a solo finite account (A-6 regression guard)', () => {
    // A single 15GB finite drive (isUnlimited=false, freeSpace=14GB) must reject
    // a 20GB upload. The old stored-only bug treated finite drives as unlimited
    // and over-accepted (probe B6b); isUnlimited=false prevents this.
    const drives: DriveWithQuota[] = [
      { ...limitedDrives[1], id: 'finite', freeSpace: 14 * 1024 ** 3, isUnlimited: false },
    ];
    const router = new UploadRouter(drives);
    expect(() => router.selectDriveForUpload(20 * 1024 ** 3)).toThrowError(
      'Insufficient overall quota for this file',
    );
  });

  it('is stable among unlimited drives (preserves insertion order)', () => {
    const drives: DriveWithQuota[] = [
      { ...limitedDrives[0], id: 'unlimited-a', freeSpace: 0, isUnlimited: true },
      { ...limitedDrives[1], id: 'unlimited-b', freeSpace: 0, isUnlimited: true },
    ];
    const router = new UploadRouter(drives);
    const selected = router.selectDriveForUpload(100);
    expect(selected.id).toBe('unlimited-a'); // first in insertion order
  });

  it('stale clients (isUnlimited undefined) fall through to freeSpace-desc', () => {
    // A web client that hasn't deployed the isUnlimited field yet sends
    // isUnlimited=undefined. The comparator treats this as 0 (not unlimited),
    // so sorting falls through to freeSpace-desc — the old behavior.
    const staleDrives = limitedDrives.map((d) => {
      const { isUnlimited: _omit, ...rest } = d;
      return rest as DriveWithQuota;
    });
    const router = new UploadRouter(staleDrives);
    const selected = router.selectDriveForUpload(100);
    expect(selected.id).toBe('drive2'); // drive2 has more freeSpace
  });
});
