import { useState, ComponentProps } from 'react';
import { FolderPlus, RefreshCw, ChevronRight } from 'lucide-react';
import type { WorkspaceFolder, BreadcrumbItem } from '../../types';
import { WorkspaceFilesTab } from './WorkspaceFilesTab';
import { WorkspaceMembersTab } from './WorkspaceMembersTab';
import { WorkspaceSettingsTab } from './WorkspaceSettingsTab';
import { WorkspaceAuditTab } from './WorkspaceAuditTab';

interface WorkspaceMainViewProps {
  activeFolder: WorkspaceFolder | null;
  path: BreadcrumbItem[];
  onCreateFolder: () => void;
  onCreateRootFolder: () => void;
  onSync: () => void;
  isSyncing: boolean;
  fileTabProps: ComponentProps<typeof WorkspaceFilesTab>;
}

export function WorkspaceMainView({ 
  activeFolder, path, onCreateFolder, onCreateRootFolder, onSync, isSyncing, fileTabProps 
}: WorkspaceMainViewProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'members' | 'settings' | 'audit'>('files');

  if (!activeFolder) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-gray-50 border-l border-gray-200 gap-4">
        <p>Select or create a Workspace to get started.</p>
        <button onClick={onCreateRootFolder} className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
          <FolderPlus size={16} /> New Workspace
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header Area */}
      <div className="px-8 pt-8 pb-4 border-b border-gray-200 flex flex-col gap-4">
        {/* Breadcrumbs */}
        <div className="flex items-center text-sm text-gray-500 gap-2">
          {path.map((item, index) => (
            <div key={item.id || index} className="flex items-center gap-2">
              <span className="hover:text-gray-900 cursor-pointer">{item.name}</span>
              {index < path.length - 1 && <ChevronRight size={14} />}
            </div>
          ))}
        </div>

        {/* Title & Actions */}
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold text-gray-900">{activeFolder.name}</h1>
          <div className="flex gap-2">
            <button onClick={onCreateFolder} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              <FolderPlus size={16} /> New Folder
            </button>
            <button onClick={onSync} disabled={isSyncing} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
              <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} /> Sync
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mt-4">
          {(['files', 'members', 'settings', 'audit'] as const).map(tab => (
            <button 
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab 
                  ? 'border-gray-900 text-gray-900' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-gray-50">
        {activeTab === 'files' && <WorkspaceFilesTab {...fileTabProps} />}
        {activeTab === 'members' && <WorkspaceMembersTab />}
        {activeTab === 'settings' && <WorkspaceSettingsTab workspaceId={activeFolder.id} />}
        {activeTab === 'audit' && <WorkspaceAuditTab workspaceId={activeFolder.id} />}
      </div>
    </div>
  );
}
