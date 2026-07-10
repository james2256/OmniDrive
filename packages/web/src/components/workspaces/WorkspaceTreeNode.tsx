import { ChevronRight, ChevronDown, MoreHorizontal, FolderPlus, Edit2, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { WorkspaceFolder } from '../../types';

interface WorkspaceTreeNodeProps {
  folder: WorkspaceFolder;
  level: number;
  activeFolderId: string | null;
  expandedIds: Set<string>;
  childrenMap: Map<string | null, WorkspaceFolder[]>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
}

export function WorkspaceTreeNode({
  folder, level, activeFolderId, expandedIds, childrenMap,
  onSelect, onToggle, onRename, onDelete, onNewSubfolder
}: WorkspaceTreeNodeProps) {
  const children = childrenMap.get(folder.id) || [];
  const hasChildren = children.length > 0;
  const isExpanded = expandedIds.has(folder.id);
  const isActive = activeFolderId === folder.id;

  return (
    <div className="group flex flex-col">
      <div 
        className={`flex items-center justify-between px-2 py-1.5 mx-2 rounded-md cursor-pointer transition-colors ${
          isActive ? 'bg-blue-50 text-blue-900 font-medium' : 'text-stone-700 hover:bg-stone-100'
        }`}
        style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
      >
        <div className="flex items-center gap-1.5 overflow-hidden flex-1" onClick={() => onSelect(folder.id)}>
          <button 
            data-testid={`tree-node-toggle-${folder.id}`}
            onClick={(e) => { e.stopPropagation(); onToggle(folder.id); }}
            className="p-0.5 rounded hover:bg-stone-200 text-stone-400"
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <div className="w-[14px]" /> // Spacer
            )}
          </button>
          <span className="truncate text-sm">{folder.name}</span>
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button 
              onClick={(e) => e.stopPropagation()} 
              className="p-1 rounded hover:bg-stone-200 text-stone-500 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 focus-within:opacity-100 transition-opacity"
            >
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="min-w-[160px] bg-card rounded-md shadow-lg border border-stone-200 p-1 z-50">
              <DropdownMenu.Item onSelect={() => onNewSubfolder(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 hover:outline-none rounded cursor-pointer">
                <FolderPlus size={14} /> New Sub-folder
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => onRename(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 hover:outline-none rounded cursor-pointer">
                <Edit2 size={14} /> Rename
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="h-px bg-stone-200 my-1" />
              <DropdownMenu.Item onSelect={() => onDelete(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 hover:outline-none rounded cursor-pointer">
                <Trash2 size={14} /> Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      {hasChildren && (
        <div className={`grid transition-[grid-template-rows] duration-200 ease-in-out ${isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            {children.map(child => (
              <WorkspaceTreeNode
                key={child.id}
                folder={child}
                level={level + 1}
                activeFolderId={activeFolderId}
                expandedIds={expandedIds}
                childrenMap={childrenMap}
                onSelect={onSelect}
                onToggle={onToggle}
                onRename={onRename}
                onDelete={onDelete}
                onNewSubfolder={onNewSubfolder}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
