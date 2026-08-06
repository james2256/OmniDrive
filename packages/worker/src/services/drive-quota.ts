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
  onQuotaPersist?: (driveId: string, total: number, used: number) => void,
): Promise<DriveWithQuota[]> {
  const driveRepo = new DriveRepository(db);
  const { results } = await driveRepo.findAllByUser(userId);

  const drives = results.map(mapDriveRow);

  const tasks = drives.map((drive) => async () => {
    try {
      const driveService = createDriveService(env);
      const quota = await driveService.getQuota(drive.id);
      onQuotaPersist?.(drive.id, quota.total, quota.used);
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
      // Google API failure or corrupt tokens (AuthError) — treat unknown
      // stored quota as unlimited for routing.
      const computed = computeDriveQuota({
        totalQuota: drive.totalQuota,
        usedQuota: drive.usedQuota,
      });
      return { ...drive, ...computed };
    }
  });

  return runWithConcurrency(tasks, 3);
}
