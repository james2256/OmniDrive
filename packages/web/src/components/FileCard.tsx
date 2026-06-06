import { MoreVertical, Download, Trash2, Pencil } from 'lucide-react';
import { getFileIcon, formatFileSize, formatRelativeTime } from '../lib/utils';
import type { FileEntry } from '../types';
import { useState } from 'react';

interface FileCardProps {
  file: FileEntry;
  driveColor: string;
  onDelete?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onPreview?: (file: FileEntry) => void;
}

export function FileCard({ file, driveColor, onDelete, onRename, onPreview }: FileCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="file-card" onClick={() => onPreview?.(file)}>
      <div className="file-card-icon">{getFileIcon(file.mimeType)}</div>
      <div className="file-card-info">
        <div className="file-card-name truncate">{file.name}</div>
        <div className="file-card-meta">
          <div className="drive-dot" style={{ backgroundColor: driveColor }} />
          <span>{formatFileSize(file.size)}</span>
          <span>·</span>
          <span>{formatRelativeTime(file.googleModifiedAt ?? file.createdAt)}</span>
        </div>
      </div>
      <div className="file-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-ghost btn-sm" onClick={() => setMenuOpen(!menuOpen)}>
          <MoreVertical size={16} />
        </button>
        {menuOpen && (
          <div className="file-card-menu">
            {file.webContentLink && (
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

      <style>{fileCardStyles}</style>
    </div>
  );
}

const fileCardStyles = `
  .file-card {
    display: flex;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-md);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background var(--transition-fast);
    position: relative;
  }

  .file-card:hover { background: var(--bg-hover); }

  .file-card-icon { font-size: 1.5rem; flex-shrink: 0; }

  .file-card-info { flex: 1; min-width: 0; }

  .file-card-name {
    font-size: var(--font-size-base);
    font-weight: 500;
  }

  .file-card-meta {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .file-card-actions { position: relative; }

  .file-card-menu {
    position: absolute;
    right: 0;
    top: 100%;
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    padding: var(--space-xs);
    min-width: 150px;
    box-shadow: var(--shadow-lg);
    z-index: 10;
  }

  .file-card-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    width: 100%;
    text-align: left;
    cursor: pointer;
    border: none;
    background: none;
    text-decoration: none;
  }

  .file-card-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .file-card-menu-item.danger:hover { background: var(--accent-danger-subtle); color: var(--accent-danger); }
`;
