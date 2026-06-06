import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { DriveService } from '../services/drive.service';
import { mapDriveRow } from '../types';

export const drivesRouter = new Hono<AppContext>({ strict: false });

drivesRouter.use('*', authGuard);

drivesRouter.get('/', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;

  const { results } = await db
    .prepare('SELECT * FROM drive_accounts WHERE user_id = ?')
    .bind(userId)
    .all();

  const drives = results.map(mapDriveRow);
  
  // For each drive, fetch live quota if it hasn't been updated recently
  // For simplicity in this demo, we'll fetch it live every time
  const drivesWithQuota = await Promise.all(drives.map(async (drive) => {
    const tokenJson = await c.env.KV.get(`tokens:${drive.id}`);
    if (!tokenJson) return { ...drive, freeSpace: 0, usagePercent: 0 };
    
    try {
      const tokens = JSON.parse(tokenJson);
      const driveService = new DriveService(c.env, drive.id, tokens);
      const quota = await driveService.getQuota();
      
      const freeSpace = quota.total - quota.used;
      const usagePercent = quota.total > 0 ? (quota.used / quota.total) * 100 : 0;

      // Update DB in background
      c.executionCtx.waitUntil(
        db.prepare('UPDATE drive_accounts SET total_quota = ?, used_quota = ?, quota_updated_at = datetime("now") WHERE id = ?')
          .bind(quota.total, quota.used, drive.id).run()
      );

      return {
        ...drive,
        totalQuota: quota.total,
        usedQuota: quota.used,
        freeSpace,
        usagePercent,
      };
    } catch (e) {
      console.error(`Failed to fetch quota for drive ${drive.id}`, e);
      // Fallback to cached DB values
      const freeSpace = Math.max(0, drive.totalQuota - drive.usedQuota);
      const usagePercent = drive.totalQuota > 0 ? (drive.usedQuota / drive.totalQuota) * 100 : 0;
      return { ...drive, freeSpace, usagePercent };
    }
  }));

  const aggregate = {
    totalQuota: drivesWithQuota.reduce((sum, d) => sum + d.totalQuota, 0),
    totalUsed: drivesWithQuota.reduce((sum, d) => sum + d.usedQuota, 0),
    totalFree: drivesWithQuota.reduce((sum, d) => sum + d.freeSpace, 0),
    driveCount: drivesWithQuota.length,
  };

  return c.json({ drives: drivesWithQuota, aggregate });
});

drivesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const driveId = c.req.param('id');
  
  // D1 cascade delete will handle files
  await c.env.DB.prepare('DELETE FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveId, userId).run();
    
  await c.env.KV.delete(`tokens:${driveId}`);
  
  return c.json({ success: true });
});
