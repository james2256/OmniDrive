import { useState } from 'react';
import type { ComponentProps } from 'react';
import { FolderPlus, RefreshCw, ChevronRight, PanelLeft } from 'lucide-react';
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
  onToggleSidebar?: () => void;
}

export function WorkspaceMainView({ 
  activeFolder, path, onCreateFolder, onCreateRootFolder, onSync, isSyncing, fileTabProps, onToggleSidebar 
}: WorkspaceMainViewProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'members' | 'settings' | 'audit'>('files');

  if (!activeFolder) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-50 gap-4 p-4 text-center">
        {onToggleSidebar && (
          <button onClick={onToggleSidebar} className="md:hidden flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-lg hover:bg-slate-50 transition-colors">
            <PanelLeft size={16} /> Browse Workspaces
          </button>
        )}
        <p>Select or create a Workspace to get started.</p>
        <button onClick={onCreateRootFolder} className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors">
          <FolderPlus size={16} /> New Workspace
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-card min-w-0">
      {/* Header Area */}
      <div className="px-3 sm:px-6 pt-3 sm:pt-4 pb-3 border-b border-slate-200 flex flex-col gap-2">
        {/* Breadcrumbs + sidebar toggle */}
        <div className="flex items-center text-xs sm:text-sm text-slate-500 gap-2 min-w-0">
          {onToggleSidebar && (
            <button onClick={onToggleSidebar} className="md:hidden p-1.5 hover:bg-slate-100 rounded-md flex-shrink-0" aria-label="Toggle workspace tree">
              <PanelLeft size={16} />
            </button>
          )}
          {path.map((item, index) => (
            <div key={item.id || index} className="flex items-center gap-1.5 min-w-0">
              <span className="hover:text-slate-900 cursor-pointer truncate">{item.name}</span>
              {index < path.length - 1 && <ChevronRight size={12} className="flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Title & Actions */}
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg sm:text-2xl font-semibold text-slate-900 truncate">{activeFolder.name}</h1>
          <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
            <button onClick={onCreateFolder} className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50">
              <FolderPlus size={14} /> <span className="hidden sm:inline">New Folder</span>
            </button>
            <button onClick={onSync} disabled={isSyncing} className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-md hover:bg-slate-50">
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Sync</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-3 sm:gap-6 mt-1">
          {(['files', 'members', 'settings', 'audit'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-xs sm:text-sm font-medium capitalize border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-400'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto bg-slate-50">
        {activeTab === 'files' && <WorkspaceFilesTab {...fileTabProps} />}
        {activeTab === 'members' && <WorkspaceMembersTab />}
        {activeTab === 'settings' && <WorkspaceSettingsTab workspaceId={activeFolder.id} />}
        {activeTab === 'audit' && <WorkspaceAuditTab workspaceId={activeFolder.id} />}
      </div>
    </div>
  );
}
