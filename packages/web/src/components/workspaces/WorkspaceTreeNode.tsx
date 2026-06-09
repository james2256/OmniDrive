import { useState } from 'react';
import { ChevronRight, ChevronDown, MoreHorizontal, FolderPlus, Edit2, Trash2 } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { WorkspaceFolder } from '../../types';

interface WorkspaceTreeNodeProps {
  folder: WorkspaceFolder;
  level: number;
  isExpanded: boolean;
  isActive: boolean;
  hasChildren: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onNewSubfolder: (parentId: string) => void;
}

export function WorkspaceTreeNode({
  folder, level, isExpanded, isActive, hasChildren,
  onSelect, onToggle, onRename, onDelete, onNewSubfolder
}: WorkspaceTreeNodeProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      className="group flex flex-col"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div 
        className={`flex items-center justify-between px-2 py-1.5 mx-2 rounded-md cursor-pointer transition-colors ${
          isActive ? 'bg-blue-50 text-blue-900 font-medium' : 'text-gray-700 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${level * 0.75 + 0.5}rem` }}
      >
        <div className="flex items-center gap-1.5 overflow-hidden flex-1" onClick={() => onSelect(folder.id)}>
          <button 
            data-testid={`tree-node-toggle-${folder.id}`}
            onClick={(e) => { e.stopPropagation(); onToggle(folder.id); }}
            className="p-0.5 rounded hover:bg-gray-200 text-gray-400"
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : (
              <div className="w-[14px]" /> // Spacer
            )}
          </button>
          <span className="truncate text-sm">{folder.name}</span>
        </div>

        {isHovered && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button 
                onClick={(e) => e.stopPropagation()} 
                className="p-1 rounded hover:bg-gray-200 text-gray-500"
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="min-w-[160px] bg-white rounded-md shadow-lg border border-gray-200 p-1 z-50">
                <DropdownMenu.Item onClick={() => onNewSubfolder(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 hover:outline-none rounded cursor-pointer">
                  <FolderPlus size={14} /> New Sub-folder
                </DropdownMenu.Item>
                <DropdownMenu.Item onClick={() => onRename(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100 hover:outline-none rounded cursor-pointer">
                  <Edit2 size={14} /> Rename
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="h-px bg-gray-200 my-1" />
                <DropdownMenu.Item onClick={() => onDelete(folder.id)} className="flex items-center gap-2 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 hover:outline-none rounded cursor-pointer">
                  <Trash2 size={14} /> Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        )}
      </div>
    </div>
  );
}
