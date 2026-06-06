import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { generateId } from '../lib/id';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../middleware/error-handler';
import { DriveService } from '../services/drive.service';
import { UploadRouter } from '../services/upload-router';
import { mapDriveRow, mapFileRow } from '../types';

export const filesRouter = new Hono<AppContext>({ strict: false });

filesRouter.use('*', authGuard);

// GET /api/files/search?q=
filesRouter.get('/search', async (c) => {
  const userId = c.get('userId');
  const query = c.req.query('q');

  if (!query?.trim()) {
    throw new AppError(400, 'Search query is required');
  }

  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT f.*, d.email as driveEmail FROM files f
     JOIN drive_accounts d ON f.drive_account_id = d.id
     WHERE f.user_id = ? AND f.name LIKE ? AND f.is_trashed = 0
     ORDER BY f.updated_at DESC LIMIT 50`
  ).bind(userId, `%${query.trim()}%`).all();

  return c.json({
    files: results.map((r: any) => ({
      ...mapFileRow(r),
      driveEmail: r.driveEmail,
    })),
    query: query.trim(),
  });
});

// Move file to trash
filesRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const db = c.env.DB;

  await db.prepare('UPDATE files SET is_trashed = 1 WHERE id = ? AND user_id = ?')
    .bind(fileId, userId).run();

  return c.json({ success: true });
});

// Rename file
filesRouter.patch('/:id/rename', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const { name } = await c.req.json();

  if (!name) throw new AppError(400, 'Name is required');

  await c.env.DB.prepare('UPDATE files SET name = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?')
    .bind(name, fileId, userId).run();

  return c.json({ success: true });
});

// Move file to different virtual folder
filesRouter.patch('/:id/move', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const { folderId } = await c.req.json();

  if (folderId) {
    const folder = await c.env.DB.prepare('SELECT id FROM virtual_folders WHERE id = ? AND user_id = ?').bind(folderId, userId).first();
    if (!folder) throw new AppError(404, 'Target folder not found or unauthorized');
  }

  await c.env.DB.prepare('UPDATE files SET virtual_folder_id = ?, updated_at = datetime("now") WHERE id = ? AND user_id = ?')
    .bind(folderId || null, fileId, userId).run();

  return c.json({ success: true });
});

// Initialize upload (returns Google Drive Resumable URL)
filesRouter.post('/upload/init', async (c) => {
  const userId = c.get('userId');
  const { name, mimeType, size, folderId } = await c.req.json();
  console.log(`Init upload for folder: ${folderId}`); // prevent unused var error
  const db = c.env.DB;

  // 1. Get all drives to calculate routing
  const { results: driveRows } = await db.prepare('SELECT * FROM drive_accounts WHERE user_id = ?').bind(userId).all();
  if (driveRows.length === 0) throw new AppError(400, 'No connected drives');

  const drives = driveRows.map(mapDriveRow).map((d) => ({
    ...d,
    freeSpace: Math.max(0, d.totalQuota - d.usedQuota),
    usagePercent: d.totalQuota > 0 ? (d.usedQuota / d.totalQuota) * 100 : 0
  }));

  // 2. Select target drive using UploadRouter
  const router = new UploadRouter(drives);
  const targetDrive = router.selectDriveForUpload(size);

  // 3. Get token for target drive
  const tokenJson = await c.env.KV.get(`tokens:${targetDrive.id}`);
  if (!tokenJson) throw new AppError(401, 'Drive token missing');
  const tokens = JSON.parse(tokenJson);

  // 4. Create resumable upload session in Google Drive
  const driveService = new DriveService(c.env, targetDrive.id, tokens);
  
  // Note: we place it in root or a specific Omnidrive hidden folder inside Google Drive.
  // For simplicity, we just put it in root of that specific Drive.
  const uploadUrl = await driveService.createResumableUploadSession({
    name,
    mimeType,
  });

  // 5. Return the URL so the client can stream bytes directly to Google
  return c.json({
    uploadUrl,
    driveAccountId: targetDrive.id,
    googleFolderId: targetDrive.rootFolderId,
  });
});

filesRouter.post('/upload/finalize', async (c) => {
  const userId = c.get('userId');
  const { googleFileId, driveAccountId, name, mimeType, size, folderId } = await c.req.json();

  if (!googleFileId || !driveAccountId) {
    throw new AppError(400, 'Missing required fields');
  }

  // Validate that drive belongs to user
  const db = c.env.DB;
  const drive = await db.prepare('SELECT id FROM drive_accounts WHERE id = ? AND user_id = ?')
    .bind(driveAccountId, userId).first();
    
  if (!drive) throw new AppError(404, 'Drive account not found or unauthorized');

  const id = generateId();
  
  await db.prepare(`
    INSERT INTO files (
      id, user_id, drive_account_id, virtual_folder_id, 
      google_file_id, name, mime_type, size
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, driveAccountId, folderId || null,
    googleFileId, name, mimeType, size
  ).run();

  return c.json({ id, success: true });
});
