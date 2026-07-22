import React, { useState } from 'react';
import { useSelectionStore } from '../../stores/useSelectionStore';
import { useToastStore } from '../../stores/useToastStore';
import { api } from '../../lib/api';
import { X, Trash2, Folder, Star, HardDrive } from 'lucide-react';

export interface BulkActionBarProps {
  onActionComplete: () => void;
  onMoveRequested?: () => void;
  onWorkspaceRequested?: () => void;
  onMoveDriveRequested?: () => void;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({ onActionComplete, onMoveRequested, onWorkspaceRequested, onMoveDriveRequested }) => {
  const { selectedItems, clearSelection } = useSelectionStore();
  const addToast = useToastStore((s) => s.addToast);
  const [isProcessing, setIsProcessing] = useState(false);

  if (selectedItems.length === 0) return null;

  const allFiles = selectedItems.every(i => i.type === 'file');

  const handleDelete = async () => {
    const hasFolders = selectedItems.some((i) => i.type === 'folder');
    const msg = hasFolders
      ? `Delete ${selectedItems.length} items permanently? Folders and ALL their contents will be moved to Google Drive trash.`
      : `Delete ${selectedItems.length} items permanently?`;
    if (!confirm(msg)) return;
    setIsProcessing(true);
    addToast('info', `Deleting ${selectedItems.length} items...`);

    let successCount = 0;
    let failCount = 0;

    for (const selected of selectedItems) {
      try {
        if (selected.type === 'file') {
          await api.deleteFile(selected.item.id);
        } else {
          const folder = selected.item;
          if ('googleFolderId' in folder && folder.driveAccountId) {
            await api.deleteDriveFolder(folder.driveAccountId, folder.googleFolderId);
          } else if ('id' in folder && folder.id) {
            await api.deleteFolder(folder.id);
          }
        }
        successCount++;
      } catch (error) {
        console.error('Deletion failed for item:', selected, error);
        failCount++;
      }
    }

    if (failCount === 0) {
      addToast('success', `✅ Deleted ${successCount} items`);
    } else {
      addToast('error', `⚠️ Deleted ${successCount} items, ${failCount} failed`);
    }

    setIsProcessing(false);
    clearSelection();
    onActionComplete();
  };

  return (
    <div className="fixed bottom-4 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 flex flex-wrap items-center gap-2 bg-card/80 backdrop-blur-md border border-slate-200 text-slate-800 rounded-2xl sm:rounded-full shadow-2xl px-4 py-3 animate-in fade-in-0 slide-in-from-bottom-5 duration-300">
      <div className="flex items-center gap-3 sm:border-r sm:border-slate-200 sm:pr-4">
        <button onClick={clearSelection} disabled={isProcessing} className="p-2 hover:bg-slate-100 text-slate-500 rounded-full transition-colors" aria-label="Clear selection">
          <X size={18} />
        </button>
        <span className="font-medium text-sm text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">{selectedItems.length} selected</span>
      </div>
      <div className="flex flex-wrap items-center gap-1 sm:gap-2 sm:pl-2">
        <button onClick={handleDelete} disabled={isProcessing} className="flex items-center gap-2 px-3 py-2 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-full transition-colors text-sm font-medium" title="Delete selected items">
          <Trash2 size={16} /> <span>Delete</span>
        </button>
        <button onClick={onMoveRequested} disabled={isProcessing} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-100 text-slate-600 rounded-full transition-colors text-sm font-medium" title="Move selected items">
          <Folder size={16} /> <span>Move</span>
        </button>
        <button
          onClick={onMoveDriveRequested}
          disabled={isProcessing || !allFiles}
          className={`flex items-center gap-2 px-3 py-2 rounded-full transition-colors text-sm font-medium ${!allFiles ? 'opacity-50 cursor-not-allowed text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}
          title={!allFiles ? 'Can only move files to another drive' : 'Move to another drive'}
        >
          <HardDrive size={16} /> <span>Move Drive</span>
        </button>
        <button
          onClick={onWorkspaceRequested}
          disabled={isProcessing || !allFiles}
          className={`flex items-center gap-2 px-3 py-2 rounded-full transition-colors text-sm font-medium ${!allFiles ? 'opacity-50 cursor-not-allowed text-slate-400' : 'hover:bg-slate-100 text-slate-600'}`}
          title={!allFiles ? 'Can only add files to Workspace' : 'Add to Workspace'}
        >
          <Star size={16} /> <span>Workspace</span>
        </button>
      </div>
    </div>
  );
};
