import { useState } from 'react';
import type { ComponentProps } from 'react';
import { FolderPlus, RefreshCw, ChevronRight, PanelLeft, FolderTree } from 'lucide-react';
import type { WorkspaceFolder, BreadcrumbItem } from '../../types';
import { WorkspaceFilesTab } from './WorkspaceFilesTab';
import { WorkspaceMembersTab } from './WorkspaceMembersTab';
import { WorkspaceSettingsTab } from './WorkspaceSettingsTab';
import { WorkspaceAuditTab } from './WorkspaceAuditTab';
import { Button } from '../ui/Button';

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
  activeFolder,
  path,
  onCreateFolder,
  onCreateRootFolder,
  onSync,
  isSyncing,
  fileTabProps,
  onToggleSidebar,
}: WorkspaceMainViewProps) {
  const [activeTab, setActiveTab] = useState<'files' | 'members' | 'settings' | 'audit'>('files');

  if (!activeFolder) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 bg-slate-50 gap-4 p-4 text-center">
        {onToggleSidebar && (
          <Button
            onClick={onToggleSidebar}
            variant="secondary"
            className="md:hidden gap-1.5 rounded-lg hover:bg-slate-50"
          >
            <PanelLeft size={16} /> Browse Workspaces
          </Button>
        )}
        <p>Select or create a Workspace to get started.</p>
        <Button onClick={onCreateRootFolder} variant="primary" className="gap-1 rounded-md">
          <FolderPlus size={16} /> New Workspace
        </Button>
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
            <Button
              onClick={onToggleSidebar}
              variant="ghost"
              className="md:hidden p-1.5 rounded-md flex-shrink-0"
              aria-label="Toggle workspace tree"
            >
              <PanelLeft size={16} />
            </Button>
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
          <div className="flex items-center gap-2 min-w-0">
            <FolderTree size={20} className="text-slate-400 flex-shrink-0" aria-hidden />
            <h1 className="text-xl sm:text-2xl font-semibold text-slate-800 truncate">
              {activeFolder.name}
            </h1>
          </div>
          <div className="flex gap-1.5 sm:gap-2 flex-shrink-0">
            <Button
              onClick={onCreateFolder}
              variant="secondary"
              className="gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md hover:bg-slate-50"
            >
              <FolderPlus size={14} /> <span className="hidden sm:inline">New Folder</span>
            </Button>
            <Button
              onClick={onSync}
              disabled={isSyncing}
              variant="secondary"
              className="gap-1 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm rounded-md hover:bg-slate-50"
            >
              <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />{' '}
              <span className="hidden sm:inline">Sync</span>
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-3 sm:gap-6 mt-1">
          {(['files', 'members', 'settings', 'audit'] as const).map((tab) => (
            <Button
              key={tab}
              onClick={() => setActiveTab(tab)}
              variant="ghost"
              className={`pb-2 px-0 rounded-none border-b-2 capitalize ${activeTab === tab ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-400'} hover:bg-transparent`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Button>
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
