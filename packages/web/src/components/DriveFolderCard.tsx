import { Folder, AlertTriangle } from 'lucide-react';
import type { DriveFolder } from '../types';

interface DriveFolderCardProps {
  folder: DriveFolder;
  driveColor: string;
  driveEmail: string;
  hasError?: boolean;
  onClick: () => void;
}

export function DriveFolderCard({ folder, driveColor, driveEmail, hasError, onClick }: DriveFolderCardProps) {
  const initial = driveEmail ? driveEmail.charAt(0).toUpperCase() : '?';

  return (
    <button
      className={`folder-card ${!folder.isSynced ? 'unsynced' : ''} ${hasError ? 'error' : ''}`}
      onClick={onClick}
      title={!folder.isSynced ? 'Click to load folder contents' : folder.name}
    >
      <div className="account-badge" style={{ backgroundColor: `color-mix(in srgb, ${driveColor} 20%, transparent)`, color: driveColor, borderColor: `color-mix(in srgb, ${driveColor} 40%, transparent)` }} title={driveEmail}>
        {initial}
      </div>
      
      <span className="folder-icon">
        {hasError ? <AlertTriangle size={20} color="var(--accent-warning)" /> : <Folder size={20} />}
      </span>
      <span className="folder-name truncate">{folder.name}</span>
      
      {!folder.isSynced && !hasError && (
        <span className="unsynced-dot" title="Not yet loaded" />
      )}
    </button>
  );
}
