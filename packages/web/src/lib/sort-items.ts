import type { FileEntry, DriveFolder, WorkspaceFolder } from '../types';

export type SortField = 'name' | 'size' | 'modified';
export type SortDirection = 'asc' | 'desc';

type FolderItem = DriveFolder | WorkspaceFolder;

function compareStrings(a: string, b: string, direction: SortDirection): number {
  const result = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
}

function getFileModifiedTime(file: FileEntry): number {
  const raw = file.googleModifiedAt ?? file.googleCreatedAt ?? file.createdAt;
  if (!raw) return 0;
  const time = new Date(raw).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getFolderModifiedTime(folder: FolderItem): number {
  if ('updatedAt' in folder && folder.updatedAt) {
    const time = new Date(folder.updatedAt).getTime();
    return Number.isNaN(time) ? 0 : time;
  }
  return 0;
}

export function sortFolders(folders: FolderItem[], field: SortField, direction: SortDirection): FolderItem[] {
  const sorted = [...folders];
  sorted.sort((a, b) => {
    if (field === 'name') return compareStrings(a.name, b.name, direction);
    if (field === 'size') return 0;
    const diff = getFolderModifiedTime(a) - getFolderModifiedTime(b);
    return direction === 'asc' ? diff : -diff;
  });
  return sorted;
}

export function sortFiles(files: FileEntry[], field: SortField, direction: SortDirection): FileEntry[] {
  const sorted = [...files];
  sorted.sort((a, b) => {
    if (field === 'name') return compareStrings(a.name, b.name, direction);
    if (field === 'size') {
      const diff = a.size - b.size;
      return direction === 'asc' ? diff : -diff;
    }
    const diff = getFileModifiedTime(a) - getFileModifiedTime(b);
    return direction === 'asc' ? diff : -diff;
  });
  return sorted;
}