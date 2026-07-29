import type { QueryClient } from '@tanstack/react-query';
import { qk } from './queryKeys';

/**
 * Invalidate all queries affected by a file/folder mutation.
 *
 * Called after every mutation (star, trash, rename, move, delete, restore).
 * Guarantees no page shows stale data — FilesPage, StarredPage, TrashPage,
 * DashboardPage, SharedLinksPage all refetch automatically.
 */
export function invalidateAfterFileMutation(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.driveFolder });
  qc.invalidateQueries({ queryKey: qk.starred });
  qc.invalidateQueries({ queryKey: qk.trash });
  qc.invalidateQueries({ queryKey: qk.recent });
  qc.invalidateQueries({ queryKey: qk.sharedLinks });
  qc.invalidateQueries({ queryKey: qk.external });
  qc.invalidateQueries({ queryKey: qk.category });
  // Prefix-match all search queries ('search', 'search|pro', 'search|project', ...)
  qc.invalidateQueries({ queryKey: ['search'] });
  // Workspace tree + all folder contents (prefix-match)
  qc.invalidateQueries({ queryKey: qk.workspaceTree });
  qc.invalidateQueries({ queryKey: ['workspaceContents'] });
}
