import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import { computeDriveQuota } from '../lib/storage-quota';
import { mapDriveRow } from '../types/db';
import type { DriveWithQuota } from '../types/domain';
import { createDriveService } from '../middleware/shared-services';
import { logErrorNoCtx } from '../lib/logger';
import { DriveRepository } from '../repositories/drive.repository';

export async function resolveDrivesWithQuota(
  env: Env,
  db: D1Database,
  userId: string,
  onQuotaPersist?: (driveId: string, total: number, used: number) => void,
): Promise<DriveWithQuota[]> {
  const driveRepo = new DriveRepository(db);
  const { results } = await driveRepo.findAllByUser(userId);

  const drives = results.map(mapDriveRow);

  return Promise.all(
    drives.map(async (drive) => {
      const tokenRow = await driveRepo.findTokenStatus(drive.id);
      if (!tokenRow) {
        const { freeSpace, usagePercent } = computeDriveQuota(drive);
        return { ...drive, freeSpace, usagePercent };
      }

      try {
        const driveService = createDriveService(env);
        const quota = await driveService.getQuota(drive.id);
        onQuotaPersist?.(drive.id, quota.total, quota.used);
        const computed = computeDriveQuota(drive, quota);
        return { ...drive, ...computed };
      } catch (e) {
        logErrorNoCtx('Failed to fetch quota for drive', e, { driveId: drive.id });
        // Tokens exist but quota API failed — treat unknown stored quota as unlimited for routing
        const computed = computeDriveQuota({
          totalQuota: drive.totalQuota,
          usedQuota: drive.usedQuota,
        });
        return { ...drive, ...computed };
      }
    }),
  );
}
