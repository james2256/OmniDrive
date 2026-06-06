import { MoreVertical, Download, Trash2, Pencil, ExternalLink } from 'lucide-react';
import { getFileIcon, formatFileSize, formatRelativeTime } from '../lib/utils';
import type { FileEntry } from '../types';
import { useState } from 'react';

function getGoogleNativeBadge(mimeType: string | null): string | null {
  if (!mimeType) return null;
  const badges: Record<string, string> = {
    'application/vnd.google-apps.document': 'G Doc',
    'application/vnd.google-apps.spreadsheet': 'G Sheet',
    'application/vnd.google-apps.presentation': 'G Slides',
    'application/vnd.google-apps.form': 'G Form',
    'application/vnd.google-apps.drawing': 'G Drawing',
    'application/vnd.google-apps.sites.page': 'G Sites',
  };
  return badges[mimeType] ?? null;
}

function isGoogleNative(mimeType: string | null): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.');
}

interface FileCardProps {
  file: FileEntry;
  driveColor: string;
  driveEmail?: string;
  onDelete?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onPreview?: (file: FileEntry) => void;
}

export function FileCard({ file, driveColor, driveEmail, onDelete, onRename, onPreview }: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = getGoogleNativeBadge(file.mimeType);
  const native = isGoogleNative(file.mimeType);
  const initial = driveEmail ? driveEmail.charAt(0).toUpperCase() : '?';

  const handleClick = () => {
    if (native && file.webViewLink) {
      window.open(file.webViewLink, '_blank', 'noopener,noreferrer');
    } else {
      onPreview?.(file);
    }
  };

  return (
    <div className="file-card" onClick={handleClick}>
      {driveEmail && (
        <div className="account-badge" style={{ backgroundColor: `color-mix(in srgb, ${driveColor} 20%, transparent)`, color: driveColor, borderColor: `color-mix(in srgb, ${driveColor} 40%, transparent)` }} title={driveEmail}>
          {initial}
        </div>
      )}
      <div className="file-card-icon">{getFileIcon(file.mimeType)}</div>
      <div className="file-card-info">
        <div className="file-card-name truncate">
          {file.name}
          {badge && <span className="file-badge">{badge}</span>}
        </div>
        <div className="file-card-meta">
          <div className="drive-dot" style={{ backgroundColor: driveColor }} />
          {!native && <span>{formatFileSize(file.size)}</span>}
          {!native && <span>·</span>}
          <span>{formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}</span>
        </div>
      </div>
      <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(!menuOpen)}>
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="file-card-menu">
            {native && file.webViewLink && (
              <a href={file.webViewLink} target="_blank" rel="noopener noreferrer" className="file-card-menu-item">
                <ExternalLink size={14} /> Open in Google
              </a>
            )}
            {!native && file.webContentLink && (
              <a href={file.webContentLink} target="_blank" rel="noopener noreferrer" className="file-card-menu-item">
                <Download size={14} /> Download
              </a>
            )}
            <button
              className="file-card-menu-item"
              onClick={() => {
                const newName = prompt('Rename file:', file.name);
                if (newName && newName !== file.name) onRename?.(file.id, newName);
                setMenuOpen(false);
              }}
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              className="file-card-menu-item danger"
              onClick={() => { onDelete?.(file.id); setMenuOpen(false); }}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
