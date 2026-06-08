# Trash Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Trash feature by adding backend endpoints and a frontend UI to view, restore, and permanently delete files.

**Architecture:** We add `GET /api/files/trash`, `POST /api/files/:id/restore`, and `DELETE /api/files/:id/permanent` to the Hono worker. On the frontend, we add the corresponding functions to `api.ts`, update `FileGrid` to support `isTrashView` (disabling preview and altering the context menu), and create a new `TrashPage` hooked up to a real link in the `Sidebar`.

**Tech Stack:** React, React Router, Tailwind CSS, Zustand, Hono, SQLite

---

### Task 1: Add Backend Trash APIs

**Files:**
- Create: `packages/worker/tests/files-routes.test.ts`
- Modify: `packages/worker/src/routes/files.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/worker/tests/files-routes.test.ts
import { describe, it, expect } from 'vitest';
import { filesRouter } from '../src/routes/files';

describe('Files Router', () => {
  it('registers trash endpoints', () => {
    const routes = filesRouter.routes.map(r => `${r.method} ${r.path}`);
    expect(routes).toContain('GET /trash');
    expect(routes).toContain('POST /:id/restore');
    expect(routes).toContain('DELETE /:id/permanent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/worker && npx vitest run tests/files-routes.test.ts`
Expected: FAIL (endpoints not found)

- [ ] **Step 3: Write minimal implementation**

Modify `packages/worker/src/routes/files.ts` by appending these new routes before the export or at the bottom of the file (before `export const filesRouter`? No, it's defined at the top, just add it anywhere after `filesRouter` is declared):

```typescript
// Add these routes to packages/worker/src/routes/files.ts

// GET /api/files/trash
filesRouter.get('/trash', async (c) => {
  const userId = c.get('userId');
  const db = c.env.DB;
  
  const { results } = await db.prepare(
    `SELECT f.*, d.email as driveEmail FROM files f
     JOIN drive_accounts d ON f.drive_account_id = d.id
     WHERE f.user_id = ? AND f.is_trashed = 1
     ORDER BY f.updated_at DESC`
  ).bind(userId).all();

  return c.json({
    files: results.map((r: any) => ({
      ...mapFileRow(r),
      driveEmail: r.driveEmail,
    }))
  });
});

// POST /api/files/:id/restore
filesRouter.post('/:id/restore', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  
  await c.env.DB.prepare('UPDATE files SET is_trashed = 0, updated_at = datetime("now") WHERE id = ? AND user_id = ?')
    .bind(fileId, userId).run();

  return c.json({ success: true });
});

// DELETE /api/files/:id/permanent
filesRouter.delete('/:id/permanent', async (c) => {
  const userId = c.get('userId');
  const fileId = c.req.param('id');
  const db = c.env.DB;

  const file = await db.prepare(
    `SELECT f.google_file_id, d.id as driveId 
     FROM files f
     JOIN drive_accounts d ON f.drive_account_id = d.id
     WHERE f.id = ? AND f.user_id = ? AND f.is_trashed = 1`
  ).bind(fileId, userId).first<{ google_file_id: string; driveId: string }>();

  if (!file) throw new AppError(404, 'File not found in trash');

  const driveService = new GoogleDriveService(c.env.KV, c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET);
  
  try {
    await driveService.deleteFile(file.driveId, file.google_file_id);
  } catch (error) {
    console.error('Failed to permanently delete file from Google Drive:', error);
    // Proceed to delete from db anyway to keep state clean if Google Drive delete fails (e.g. already deleted)
  }

  await db.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').bind(fileId, userId).run();

  return c.json({ success: true });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/worker && npx vitest run tests/files-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run: `rtk git add packages/worker/src/routes/files.ts packages/worker/tests/files-routes.test.ts && rtk git commit -m "feat: add backend trash endpoints"`

### Task 2: Frontend API Client

**Files:**
- Create: `packages/web/src/lib/api.test.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/web/src/lib/api.test.ts
import { describe, it, expect } from 'vitest';
import { api } from './api';

describe('api', () => {
  it('has trash related functions', () => {
    expect(typeof api.getTrashFiles).toBe('function');
    expect(typeof api.restoreFile).toBe('function');
    expect(typeof api.deleteFilePermanent).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/lib/api.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Modify `packages/web/src/lib/api.ts` by adding the three new functions inside the `export const api = { ... }` block (e.g. right before the `getRecentFiles` definition):

```typescript
  // Trash
  getTrashFiles: () =>
    request<{ files: import('../types').FileEntry[] }>('/api/files/trash'),
  restoreFile: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/restore`, { method: 'POST' }),
  deleteFilePermanent: (id: string) =>
    request<{ success: boolean }>(`/api/files/${id}/permanent`, { method: 'DELETE' }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/lib/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run: `rtk git add packages/web/src/lib/api.ts packages/web/src/lib/api.test.ts && rtk git commit -m "feat: add frontend api client methods for trash"`

### Task 3: Update FileGrid Component

**Files:**
- Modify: `packages/web/src/components/files/FileGrid.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// (We will skip the test for this UI modification since it involves complex Context Menu interactions that are hard to unit test in isolation quickly. Proceed to implementation.)
```

- [ ] **Step 2: Write minimal implementation**

Modify `packages/web/src/components/files/FileGrid.tsx`.
Add props:
```typescript
interface FileGridProps {
  files: FileEntry[];
  subfolders: VirtualFolder[];
  getDriveInfo: (driveAccountId?: string) => { drive: DriveAccount | null; index: number };
  onShare: (id: string, type: 'file' | 'folder') => void;
  onMoveDrive: (file: FileEntry) => void;
  onPreviewFile: (file: FileEntry) => void;
  isTargetShared: (id: string) => boolean;
  viewMode?: 'grid' | 'list';
  isTrashView?: boolean;
  onRestore?: (fileId: string) => void;
  onPermanentDelete?: (fileId: string) => void;
}
```

Then in the render method, update the `onDoubleClick` handler and Context Menu items:
```tsx
// Inside the component rendering logic for the file item:
onDoubleClick={() => {
  if (isTrashView) {
    // Disable preview in trash
    return;
  }
  onPreviewFile(file);
}}

// Inside the ContextMenuContent for the file:
<ContextMenuContent className="w-48 bg-white border border-gray-200 shadow-xl rounded-xl overflow-hidden py-1">
  {isTrashView ? (
    <>
      <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onRestore?.(file.id)}>
        <RefreshCw size={16} className="mr-3 text-gray-500" />
        Restore
      </ContextMenuItem>
      <ContextMenuItem className="px-3 py-2 text-sm text-red-600 cursor-pointer hover:bg-red-50 outline-none flex items-center" onClick={() => onPermanentDelete?.(file.id)}>
        <Trash2 size={16} className="mr-3 text-red-500" />
        Delete Forever
      </ContextMenuItem>
    </>
  ) : (
    <>
      <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onPreviewFile(file)}>
        <Eye size={16} className="mr-3 text-gray-500" />
        Preview
      </ContextMenuItem>
      {/* ... existing ContextMenu items for normal view ... */}
      <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onShare(file.id, 'file')}>
        <Share2 size={16} className="mr-3 text-gray-500" />
        Share
      </ContextMenuItem>
      <ContextMenuItem className="px-3 py-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-100 outline-none flex items-center" onClick={() => onMoveDrive(file)}>
        <HardDrive size={16} className="mr-3 text-gray-500" />
        Move Drive
      </ContextMenuItem>
      <ContextMenuSeparator className="my-1 bg-gray-200" />
      <ContextMenuItem className="px-3 py-2 text-sm text-red-600 cursor-pointer hover:bg-red-50 outline-none flex items-center" onClick={() => handleDeleteFile(file.id)}>
        <Trash2 size={16} className="mr-3 text-red-500" />
        Delete
      </ContextMenuItem>
    </>
  )}
</ContextMenuContent>
```
*(Make sure you also import `RefreshCw` from `lucide-react` if not already present).*

- [ ] **Step 3: Run build to verify types pass**

Run: `cd packages/web && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

Run: `rtk git add packages/web/src/components/files/FileGrid.tsx && rtk git commit -m "feat: add trash view mode to filegrid"`

### Task 4: Add Trash Page & Routes

**Files:**
- Create: `packages/web/src/pages/TrashPage.tsx`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Write TrashPage**

```tsx
// packages/web/src/pages/TrashPage.tsx
import { useEffect, useState, useCallback } from 'react';
import { useDriveStore } from '../stores/driveStore';
import { useToastStore } from '../stores/toastStore';
import { FileGrid } from '../components/files/FileGrid';
import { api } from '../lib/api';
import type { FileEntry } from '../types';

export function TrashPage() {
  const { drives } = useDriveStore();
  const { addToast } = useToastStore();
  
  const [results, setResults] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTrash = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.getTrashFiles();
      setResults(data.files);
    } catch (error) {
      addToast('error', 'Failed to load trash');
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchTrash();
  }, [fetchTrash]);

  const handleRestore = async (fileId: string) => {
    try {
      await api.restoreFile(fileId);
      addToast('success', 'File restored successfully');
      fetchTrash();
    } catch (error) {
      addToast('error', 'Failed to restore file');
    }
  };

  const handlePermanentDelete = async (fileId: string) => {
    try {
      await api.deleteFilePermanent(fileId);
      addToast('success', 'File permanently deleted');
      fetchTrash();
    } catch (error) {
      addToast('error', 'Failed to permanently delete file');
    }
  };

  const getDriveInfo = useCallback((driveAccountId?: string) => {
    if (!driveAccountId) return { drive: null, index: 0 };
    const index = drives.findIndex((d) => d.id === driveAccountId);
    if (index === -1) return { drive: drives[0] || null, index: 0 };
    return { drive: drives[index], index };
  }, [drives]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-800">Trash</h1>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : results.length > 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <FileGrid
            files={results}
            subfolders={[]}
            getDriveInfo={getDriveInfo}
            onShare={() => {}}
            onMoveDrive={() => {}}
            onPreviewFile={() => {}}
            isTargetShared={() => false}
            viewMode="list"
            isTrashView={true}
            onRestore={handleRestore}
            onPermanentDelete={handlePermanentDelete}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <p className="text-lg">Your trash is empty.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update App.tsx Route**

Modify `packages/web/src/App.tsx`:
Import `TrashPage` and add `<Route path="/trash" element={<TrashPage />} />` under `<AppLayout>`.

- [ ] **Step 3: Update Sidebar**

Modify `packages/web/src/components/layout/Sidebar.tsx`:
Change the current Trash div:
```tsx
        <div className="flex items-center gap-3 px-4 py-2 hover:bg-gray-100 rounded-full cursor-pointer text-gray-700 text-sm">
          <Trash2 size={20} />
          <span>Trash</span>
        </div>
```
To use `NavLink`:
```tsx
        <NavLink to="/trash" className={navLinkClass}>
          <Trash2 size={20} />
          <span>Trash</span>
        </NavLink>
```

- [ ] **Step 4: Verify types pass**

Run: `cd packages/web && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

Run: `rtk git add packages/web/src/pages/TrashPage.tsx packages/web/src/App.tsx packages/web/src/components/layout/Sidebar.tsx && rtk git commit -m "feat: add trash page and navigation"`
