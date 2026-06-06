import { Link } from 'react-router-dom';
import { Trash2, Pencil } from 'lucide-react';
import type { VirtualFolder } from '../types';
import { useState } from 'react';

interface FolderCardProps {
  folder: VirtualFolder;
  onDelete?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
}

export function FolderCard({ folder, onDelete, onRename }: FolderCardProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      className="folder-card"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <Link to={`/files/${folder.id}`} className="folder-card-link">
        <span className="folder-card-icon">{folder.icon}</span>
        <span className="folder-card-name truncate">{folder.name}</span>
      </Link>
      {hovering && (
        <div className="folder-card-actions">
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault();
              const newName = prompt('Rename folder:', folder.name);
              if (newName && newName !== folder.name) onRename?.(folder.id, newName);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={(e) => {
              e.preventDefault();
              if (confirm(`Delete folder "${folder.name}"? Files will be moved to root.`)) {
                onDelete?.(folder.id);
              }
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      <style>{`
        .folder-card {
          display: flex;
          align-items: center;
          padding: var(--space-md);
          border-radius: var(--radius-md);
          transition: background var(--transition-fast);
          position: relative;
        }
        .folder-card:hover { background: var(--bg-hover); }
        .folder-card-link {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          flex: 1;
          min-width: 0;
          text-decoration: none;
          color: inherit;
        }
        .folder-card-icon { font-size: 1.25rem; flex-shrink: 0; }
        .folder-card-name { font-weight: 500; }
        .folder-card-actions { display: flex; gap: 2px; }
      `}</style>
    </div>
  );
}
