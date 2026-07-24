/** Central query key registry. Single source of truth for all TanStack Query keys. */
export const qk = {
  drives: ['drives'] as const,
  driveFolder: ['driveFolder'] as const,
  driveFolderContents: (driveId: string, folderId: string) => ['driveFolder', driveId, folderId] as const,
  starred: ['starred'] as const,
  trash: ['trash'] as const,
  recent: ['recent'] as const,
  category: ['category'] as const,
  sharedLinks: ['sharedLinks'] as const,
  search: (q: string) => ['search', q] as const,
  external: ['external'] as const,
  externalFolder: (driveId: string, folderId: string) => ['external', driveId, folderId] as const,
};
