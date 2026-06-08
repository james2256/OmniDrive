import { Hono } from 'hono';
import type { AppContext } from '../types/env';
import { authGuard } from '../middleware/auth-guard';
import { AppError } from '../middleware/error-handler';
import { generateId } from '../lib/id';
import { mapFolderRow, mapFileRow, type BreadcrumbItem } from '../types';
import { syncDriveAccount } from '../services/sync';
import { GoogleDriveService } from '../services/google-drive';
import { mapDriveRow } from '../types/index';

export const foldersRouter = new Hono<AppContext>({ strict: false });

foldersRouter.use('*', authGuard);

// Helper to build breadcrumb recursively up to root
async function buildBreadcrumb(db: any, userId: string, folderId: string | null): Promise<BreadcrumbItem[]> {
  const path: BreadcrumbItem[] = [];
  
  if (folderId) {
    const query = `
      WITH RECURSIVE breadcrumb_path(id, name, parent_id, lvl) AS (
        SELECT id, name, parent_id, 0 as lvl FROM virtual_folders WHERE id = ? AND user_id = ?
        UNION ALL
        SELECT v.id, v.name, v.parent_id, bp.lvl + 1 
        FROM virtual_folders v
        JOIN breadcrumb_path bp ON v.id = bp.parent_id
        WHERE v.user_id = ?
      )
      SELECT id, name FROM breadcrumb_path ORDER BY lvl DESC
    `;
    const { results } = await db.prepare(query).bind(folderId, userId, userId).all();
    for (const row of results) {
      path.push({ id: row.id as string, name: row.name as string });
    }
  }

  // Always start with Root
  path.unshift({ id: null, name: 'Home' });
  return path;
}

foldersRouter.get('/tree', async (c) => {
  const userId = c.get('userId');
  const { results } = await c.env.DB.prepare('SELECT * FROM virtual_folders WHERE user_id = ? ORDER BY name ASC').bind(userId).all();
  return c.json({ folders: results.map(mapFolderRow) });
});

foldersRouter.get('/:id?', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id') || null;
  const db = c.env.DB;

  let currentFolder = null;
  if (folderId) {
    const row = await db.prepare('SELECT * FROM virtual_folders WHERE id = ? AND user_id = ?')
      .bind(folderId, userId).first();
    if (!row) throw new AppError(404, 'Folder not found');
    currentFolder = mapFolderRow(row);
  }

  // Get subfolders
  const folderQuery = folderId 
    ? db.prepare('SELECT * FROM virtual_folders WHERE user_id = ? AND parent_id = ? ORDER BY name ASC').bind(userId, folderId)
    : db.prepare('SELECT * FROM virtual_folders WHERE user_id = ? AND parent_id IS NULL ORDER BY name ASC').bind(userId);
  
  const { results: subRows } = await folderQuery.all();
  const subfolders = subRows.map(mapFolderRow);

  // Get files
  const fileQuery = folderId
    ? db.prepare(`
        SELECT f.*, d.email as driveEmail 
        FROM files f 
        JOIN drive_accounts d ON f.drive_account_id = d.id 
        WHERE f.user_id = ? AND f.virtual_folder_id = ? AND f.is_trashed = 0 
        ORDER BY f.name ASC
      `).bind(userId, folderId)
    : db.prepare(`
        SELECT f.*, d.email as driveEmail 
        FROM files f 
        JOIN drive_accounts d ON f.drive_account_id = d.id 
        WHERE f.user_id = ? AND f.virtual_folder_id IS NULL AND f.is_trashed = 0 
        ORDER BY f.name ASC
      `).bind(userId);

  const { results: fileRows } = await fileQuery.all();
  const files = fileRows.map((r: any) => ({
    ...mapFileRow(r),
    driveEmail: r.driveEmail,
  }));

  const breadcrumb = await buildBreadcrumb(db, userId, folderId);

  return c.json({
    folder: currentFolder,
    subfolders,
    files,
    breadcrumb
  });
});

foldersRouter.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json();
  const { name, parentId, icon, color } = body;

  if (!name) throw new AppError(400, 'Folder name is required');

  const id = generateId();
  await c.env.DB.prepare(
    'INSERT INTO virtual_folders (id, user_id, name, parent_id, icon, color) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, userId, name, parentId || null, icon || '📁', color || '#4A90D9').run();

  return c.json({ id, name, parentId });
});

foldersRouter.put('/:id', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const body = await c.req.json();
  const { name, parentId, icon, color } = body;
  
  const updateFields: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    if (typeof name !== 'string') throw new AppError(400, 'Invalid name');
    updateFields.push('name = ?');
    params.push(name);
  }

  if (icon !== undefined) {
    if (typeof icon !== 'string' && icon !== null) throw new AppError(400, 'Invalid icon');
    updateFields.push('icon = ?');
    params.push(icon);
  }

  if (color !== undefined) {
    if (typeof color !== 'string' && color !== null) throw new AppError(400, 'Invalid color');
    updateFields.push('color = ?');
    params.push(color);
  }

  if (parentId !== undefined) {
    if (parentId !== null && typeof parentId !== 'string') throw new AppError(400, 'Invalid parentId');
    if (parentId === folderId) throw new AppError(400, 'Folder cannot be its own parent');
    
    if (parentId !== null) {
      const breadcrumb = await buildBreadcrumb(c.env.DB, userId, parentId);
      if (breadcrumb.some(b => b.id === folderId)) {
        throw new AppError(400, 'Circular dependency detected');
      }
    }
    
    updateFields.push('parent_id = ?');
    params.push(parentId);
  }

  if (updateFields.length === 0) {
    return c.json({ success: true });
  }

  updateFields.push('updated_at = datetime("now")');
  params.push(folderId, userId);

  const query = `UPDATE virtual_folders SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`;
  const { meta } = await c.env.DB.prepare(query).bind(...params).run();
  
  if (meta.changes === 0) throw new AppError(404, 'Folder not found');
  return c.json({ success: true });
});

foldersRouter.post('/:id/star', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const { meta } = await c.env.DB.prepare('UPDATE virtual_folders SET is_starred = 1, updated_at = datetime("now") WHERE id = ? AND user_id = ?').bind(folderId, userId).run();
  if (meta.changes === 0) throw new AppError(404, 'Folder not found');
  return c.json({ success: true });
});

foldersRouter.post('/:id/unstar', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const { meta } = await c.env.DB.prepare('UPDATE virtual_folders SET is_starred = 0, updated_at = datetime("now") WHERE id = ? AND user_id = ?').bind(folderId, userId).run();
  if (meta.changes === 0) throw new AppError(404, 'Folder not found');
  return c.json({ success: true });
});

foldersRouter.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');

  // Cascade delete handles subfolders, but we need to decide what happens to files
  // For this implementation, deleting a folder deletes its metadata structure,
  // but actual files might just be orphaned to the root or also deleted from Drive.
  // Standard behavior: just delete virtual folder, files cascade to NULL (handled by ON DELETE SET NULL in schema).
  await c.env.DB.prepare('DELETE FROM virtual_folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId).run();

  return c.json({ success: true });
});

foldersRouter.post('/:id/files', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  
  let body;
  try {
    body = await c.req.json<{ fileIds: string[] }>();
  } catch (e) {
    throw new AppError(400, 'Invalid JSON or missing body');
  }
  const { fileIds } = body;
  
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) return c.json({ success: true });
  
  const CHUNK_SIZE = 50;
  for (let i = 0; i < fileIds.length; i += CHUNK_SIZE) {
    const chunk = fileIds.slice(i, i + CHUNK_SIZE);
    const placeholders = chunk.map(() => '?').join(',');
    const query = `UPDATE files SET virtual_folder_id = ?, updated_at = datetime('now') WHERE user_id = ? AND id IN (${placeholders})`;
    await c.env.DB.prepare(query).bind(folderId, userId, ...chunk).run();
  }
  
  return c.json({ success: true });
});

foldersRouter.post('/:id/sync', async (c) => {
  const userId = c.get('userId');
  const folderId = c.req.param('id');
  const db = c.env.DB;
  
  const { results } = await db.prepare(`
    SELECT DISTINCT d.* 
    FROM files f 
    JOIN drive_accounts d ON f.drive_account_id = d.id 
    WHERE f.virtual_folder_id = ? AND f.user_id = ?
  `).bind(folderId, userId).all();
  
  if (results && results.length > 0) {
    const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
    for (const row of results) {
       const drive = mapDriveRow(row as any);
       // syncDriveAccount already updates the sync_state table with errors, so we just log to console here
       c.executionCtx.waitUntil(syncDriveAccount(drive, db, c.env.KV, driveService).catch(console.error));
    }
  }
  
  return c.json({ success: true });
});
