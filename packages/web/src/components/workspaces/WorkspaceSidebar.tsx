import { useState, useCallback, useMemo } from 'react';
import { Plus } from 'lucide-react';
import type { WorkspaceFolder } from '../../types';
import { WorkspaceTreeNode } from './WorkspaceTreeNode';

interface WorkspaceSidebarProps {
  folders: WorkspaceFolder[];
  activeFolderId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string | null) => void;
}

export function WorkspaceSidebar({ 
  folders, activeFolderId, onSelect, onRename, onDelete, onNewSubfolder 
}: WorkspaceSidebarProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    onSelect(id);
    setExpandedIds(prev => new Set([...prev, id])); // Auto-expand on select
  }, [onSelect]);

  const childrenMap = useMemo(() => {
    const map = new Map<string | null, WorkspaceFolder[]>();
    folders.forEach(f => {
      const parentId = f.parentId || null;
      if (!map.has(parentId)) {
        map.set(parentId, []);
      }
      map.get(parentId)!.push(f);
    });
    return map;
  }, [folders]);

  const rootFolders = childrenMap.get(null) || [];

  return (
    <div className="w-64 border-r border-stone-200 bg-stone-50/50 flex flex-col h-full overflow-y-auto py-4">
      <div className="px-4 mb-2 flex items-center justify-between group">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Workspaces</h3>
        <button 
          onClick={() => onNewSubfolder(null)} 
          className="text-stone-400 hover:text-stone-600 transition-colors"
          title="New Workspace"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1">
        {rootFolders.length === 0 ? (
          <p className="px-4 text-sm text-stone-500 italic">No workspaces yet.</p>
        ) : (
          rootFolders.map(folder => (
            <WorkspaceTreeNode
              key={folder.id}
              folder={folder}
              level={0}
              activeFolderId={activeFolderId}
              expandedIds={expandedIds}
              childrenMap={childrenMap}
              onSelect={handleSelect}
              onToggle={handleToggle}
              onRename={onRename}
              onDelete={onDelete}
              onNewSubfolder={onNewSubfolder}
            />
          ))
        )}
      </div>
    </div>
  );
}
