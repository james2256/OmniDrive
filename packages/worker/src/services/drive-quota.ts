import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types/env';
import { computeDriveQuota } from '../lib/storage-quota';
import { mapDriveRow, type DriveWithQuota } from '../types';
import { GoogleDriveService } from './google-drive';

export async function resolveDrivesWithQuota(
  env: Env,
  db: D1Database,
  userId: string,
  onQuotaPersist?: (driveId: string, total: number, used: number) => void
): Promise<DriveWithQuota[]> {
  const { results } = await db
    .prepare('SELECT * FROM drive_accounts WHERE user_id = ?')
    .bind(userId)
    .all();

  const drives = results.map(mapDriveRow);

  return Promise.all(
    drives.map(async (drive) => {
      const tokenRow = await db.prepare('SELECT 1 as ok FROM drive_tokens WHERE drive_account_id = ?').bind(drive.id).first();
      if (!tokenRow) {
        const { freeSpace, usagePercent } = computeDriveQuota(drive);
        return { ...drive, freeSpace, usagePercent };
      }

      try {
        const driveService = new GoogleDriveService(
          db,
          env.GOOGLE_CLIENT_ID,
          env.GOOGLE_CLIENT_SECRET,
          env.TOKEN_ENCRYPTION_KEY
        );
        const quota = await driveService.getQuota(drive.id);
        onQuotaPersist?.(drive.id, quota.total, quota.used);
        const computed = computeDriveQuota(drive, quota);
        return { ...drive, ...computed };
      } catch (e) {
        console.error(`Failed to fetch quota for drive ${drive.id}`, e);
        // Tokens exist but quota API failed — treat unknown stored quota as unlimited for routing
        const computed = computeDriveQuota({ totalQuota: 0, usedQuota: drive.usedQuota });
        return { ...drive, ...computed };
      }
    })
  );
}