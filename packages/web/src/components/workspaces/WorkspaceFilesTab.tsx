import { FileGrid } from '../files/FileGrid';
import type { FileEntry, WorkspaceFolder, DriveFolder } from '../../types';

interface WorkspaceFilesTabProps {
  files: FileEntry[];
  subfolders: WorkspaceFolder[];
  getDriveInfo: (id: string | null) => { drive: any; index: number };
  onNavigateFolder: (id: string) => void;
  onPreviewFile: (file: FileEntry) => void;
  onShare: (item: FileEntry | WorkspaceFolder | DriveFolder, type: 'file' | 'folder') => void;
  onRenameFile: (file: FileEntry) => void;
  onDeleteFile: (id: string) => void;
  onMoveDrive: (item: FileEntry | WorkspaceFolder | DriveFolder, type: 'file' | 'folder') => void;
  isTargetShared: (id: string | null) => boolean;
  errorDrives: Set<string>;
  onViewInfo: (item: FileEntry | WorkspaceFolder | DriveFolder, type: 'file' | 'folder') => void;
}

export function WorkspaceFilesTab(props: WorkspaceFilesTabProps) {
  return (
    <div className="flex-1 overflow-auto p-4">
      <FileGrid {...props} />
    </div>
  );
}
