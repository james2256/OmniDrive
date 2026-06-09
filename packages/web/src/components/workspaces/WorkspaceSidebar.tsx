import { useState, useCallback } from 'react';
import type { WorkspaceFolder } from '../../types';
import { WorkspaceTreeNode } from './WorkspaceTreeNode';

interface WorkspaceSidebarProps {
  folders: WorkspaceFolder[];
  activeFolderId: string | null;
  onSelect: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
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

  const rootFolders = folders.filter(f => !f.parentId);

  const renderTree = (folderList: WorkspaceFolder[], level: number = 0) => {
    return folderList.map(folder => {
      const children = folders.filter(f => f.parentId === folder.id);
      const isActive = activeFolderId === folder.id;
      const isExpanded = expandedIds.has(folder.id);

      return (
        <div key={folder.id}>
          <WorkspaceTreeNode
            folder={folder}
            level={level}
            isExpanded={isExpanded}
            isActive={isActive}
            hasChildren={children.length > 0}
            onSelect={handleSelect}
            onToggle={handleToggle}
            onRename={onRename}
            onDelete={onDelete}
            onNewSubfolder={onNewSubfolder}
          />
          {isExpanded && children.length > 0 && renderTree(children, level + 1)}
        </div>
      );
    });
  };

  return (
    <div className="w-64 border-r border-gray-200 bg-gray-50/50 flex flex-col h-full overflow-y-auto py-4">
      <div className="px-4 mb-2 flex items-center justify-between group">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Workspaces</h3>
      </div>
      <div className="flex-1">
        {rootFolders.length === 0 ? (
          <p className="px-4 text-sm text-gray-500 italic">No workspaces yet.</p>
        ) : (
          renderTree(rootFolders)
        )}
      </div>
    </div>
  );
}
