import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import { computeDriveQuota } from '../lib/storage-quota';
import { mapDriveRow } from '../types/db';
import type { DriveWithQuota } from '../types/domain';
import { createDriveService } from '../lib/drive-factory';
import { logErrorNoCtx } from '../lib/logger';
import { runWithConcurrency } from '../lib/concurrency';
import { DriveRepository } from '../repositories/drive.repository';
import { NotFoundError } from '../lib/errors';

export async function resolveDrivesWithQuota(
  env: Env,
  db: D1Database,
  userId: string,
  onQuotaPersist?: (driveId: string, total: number, used: number, hasLimit: boolean) => void,
  maxFetches?: number,
): Promise<DriveWithQuota[]> {
  const driveRepo = new DriveRepository(db);
  const { results } = await driveRepo.findAllByUser(userId);

  const drives = results.map(mapDriveRow);

  // Cap live fetches to stay within the 50-subrequest budget (mirrors
  // drives.ts:137 MAX_QUOTA_FETCHES). getQuota is cache-first (0 external on
  // a D1 cache hit within the 5-min TTL; ~2 external on a miss), so the cap
  // is a safety bound for >10 drives. Drives beyond the cap use stored-only
  // quota (isUnlimited=false → excluded from auto-selection until live data
  // is available on a subsequent request).
  const fetchCount = maxFetches != null ? Math.min(maxFetches, drives.length) : drives.length;
  const fetchBatch = drives.slice(0, fetchCount);
  const remaining = drives.slice(fetchCount);

  const tasks = fetchBatch.map((drive) => async () => {
    try {
      const driveService = createDriveService(env);
      const quota = await driveService.getQuota(drive.id);
      // Gated persist (mirrors drives.ts:157-168): skip the write entirely
      // when nothing changed. The hasLimit gate (updateQuota vs
      // updateUsedQuota) is the caller's responsibility — it has
      // c.executionCtx for waitUntil.
      const quotaChanged = quota.hasLimit
        ? drive.totalQuota !== quota.total || drive.usedQuota !== quota.used
        : drive.usedQuota !== quota.used;
      if (quotaChanged) {
        onQuotaPersist?.(drive.id, quota.total, quota.used, quota.hasLimit);
      }
      const computed = computeDriveQuota(drive, quota);
      return { ...drive, ...computed };
    } catch (e) {
      // NotFoundError: drive disconnected (no tokens row). Return cached quota
      // silently — same as the previous findTokenStatus null path, but without
      // the redundant D1 read (loadTokens already throws NotFoundError).
      if (e instanceof NotFoundError) {
        const computed = computeDriveQuota(drive);
        return { ...drive, ...computed };
      }
      logErrorNoCtx('Failed to fetch quota for drive', e, { driveId: drive.id });
      // Google API failure or corrupt tokens (AuthError) — fall back to
      // stored quota. Pass quotaOverride through (unlike the previous
      // version which dropped it, causing an override-backed drive to lose
      // its finite limit on a transient API failure). isUnlimited is false
      // (no live confirmation), so the drive is excluded from auto-selection
      // until live quota is re-fetched — preventing a mis-route (A-6b).
      const computed = computeDriveQuota({
        totalQuota: drive.totalQuota,
        usedQuota: drive.usedQuota,
        quotaOverride: drive.quotaOverride,
      });
      return { ...drive, ...computed };
    }
  });

  const fetched = await runWithConcurrency(tasks, 3);

  // Remaining drives beyond the fetch cap: stored-only quota (isUnlimited=false).
  const remainingWithQuota = remaining.map((drive) => {
    const computed = computeDriveQuota(drive);
    return { ...drive, ...computed };
  });

  return [...fetched, ...remainingWithQuota];
}
