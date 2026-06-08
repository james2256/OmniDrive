import { Folder } from 'lucide-react';
import type { VirtualFolder } from '../../types';

interface VirtualFolderSidebarProps {
  folders: VirtualFolder[];
  activeFolderId: string | null;
  onSelect: (id: string) => void;
}

export function VirtualFolderSidebar({ folders, activeFolderId, onSelect }: VirtualFolderSidebarProps) {
  const rootFolders = folders.filter(f => !f.parentId);

  const renderTree = (folderList: VirtualFolder[], level: number = 0) => {
    return folderList.map(folder => {
      const children = folders.filter(f => f.parentId === folder.id);
      const isActive = activeFolderId === folder.id;
      return (
        <div key={folder.id} className="flex flex-col">
          <button
            onClick={() => onSelect(folder.id)}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-gray-100 rounded-md mx-2 ${isActive ? 'bg-[#c2e7ff] text-gray-900 font-medium' : 'text-gray-700'}`}
            style={{ paddingLeft: `${level * 1 + 0.75}rem` }}
          >
            {folder.icon ? <span>{folder.icon}</span> : <Folder size={16} className="text-gray-400" />}
            <span className="truncate">{folder.name}</span>
          </button>
          {children.length > 0 && renderTree(children, level + 1)}
        </div>
      );
    });
  };

  return (
    <div className="w-64 border-r border-gray-200 bg-white flex flex-col h-full overflow-y-auto py-4">
      <h3 className="px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Virtual Folders</h3>
      <div className="flex-1">
        {rootFolders.length === 0 ? (
          <p className="px-4 text-sm text-gray-500 italic">No virtual folders yet.</p>
        ) : (
          renderTree(rootFolders)
        )}
      </div>
    </div>
  );
}
