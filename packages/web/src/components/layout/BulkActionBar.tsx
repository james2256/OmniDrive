import React, { useState } from 'react';
import { useSelectionStore } from '../../stores/useSelectionStore';
import { useToastStore } from '../../stores/useToastStore';
import { api } from '../../lib/api';
import { X, Trash2, Folder, Star, HardDrive, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';

export interface BulkActionBarProps {
  onActionComplete: () => void;
  onMoveRequested?: () => void;
  onWorkspaceRequested?: () => void;
  onMoveDriveRequested?: () => void;
  isTrashView?: boolean;
}

export const BulkActionBar: React.FC<BulkActionBarProps> = ({ onActionComplete, onMoveRequested, onWorkspaceRequested, onMoveDriveRequested, isTrashView = false }) => {
  const { selectedItems, clearSelection } = useSelectionStore();
  const addToast = useToastStore((s) => s.addToast);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  if (selectedItems.length === 0) return null;

  const allFiles = selectedItems.every(i => i.type === 'file');

  const handleDelete = () => {
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setIsConfirming(true);
    setIsProcessing(true);
    addToast('info', `${isTrashView ? 'Permanently deleting' : 'Deleting'} ${selectedItems.length} items...`);

    let successCount = 0;
    let failCount = 0;

    for (const selected of selectedItems) {
      try {
        if (selected.type === 'file') {
          if (isTrashView) {
            await api.deleteFilePermanent(selected.item.id);
          } else {
            await api.deleteFile(selected.item.id);
          }
        } else {
          const folder = selected.item;
          if ('googleFolderId' in folder && folder.driveAccountId) {
            if (isTrashView) {
              await api.deleteDriveFolderPermanent(folder.driveAccountId, folder.googleFolderId);
            } else {
              await api.deleteDriveFolder(folder.driveAccountId, folder.googleFolderId);
            }
          } else if ('id' in folder && folder.id) {
            await api.deleteFolder(folder.id);
          }
        }
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (failCount === 0) {
      addToast('success', `${isTrashView ? 'Permanently deleted' : 'Deleted'} ${successCount} items`);
    } else {
      addToast('error', `${successCount} succeeded, ${failCount} failed`);
    }

    setIsProcessing(false);
    setIsConfirming(false);
    setConfirmOpen(false);
    clearSelection();
    onActionComplete();
  };

  const handleRestore = async () => {
    setIsProcessing(true);
    addToast('info', `Restoring ${selectedItems.length} items...`);

    let successCount = 0;
    let failCount = 0;

    for (const selected of selectedItems) {
      try {
        if (selected.type === 'file') {
          await api.restoreFile(selected.item.id);
        } else {
          const folder = selected.item;
          if ('googleFolderId' in folder && folder.driveAccountId) {
            await api.restoreDriveFolder(folder.driveAccountId, folder.googleFolderId);
          }
        }
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (failCount === 0) {
      addToast('success', `Restored ${successCount} items`);
    } else {
      addToast('error', `${successCount} restored, ${failCount} failed`);
    }

    setIsProcessing(false);
    clearSelection();
    onActionComplete();
  };

  return (
    <>
    <div className="fixed bottom-3 left-2 right-2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 flex flex-wrap items-center gap-1.5 sm:gap-2 bg-card/80 backdrop-blur-md border border-slate-200 text-slate-800 rounded-2xl sm:rounded-full shadow-2xl px-3 py-2 sm:px-4 sm:py-3 animate-in fade-in-0 slide-in-from-bottom-5 duration-300">
      <div className="flex items-center gap-2 sm:gap-3 sm:border-r sm:border-slate-200 sm:pr-4">
        <button onClick={clearSelection} disabled={isProcessing} className="p-1.5 sm:p-2 hover:bg-slate-100 text-slate-500 rounded-full transition-colors" aria-label="Clear selection">
          <X size={18} />
        </button>
        <span className="font-medium text-sm text-blue-600 bg-blue-50 px-2.5 py-0.5 rounded-full">{selectedItems.length} selected</span>
      </div>
      <div className="flex flex-wrap items-center gap-0.5 sm:gap-2 sm:pl-2">
        {isTrashView ? (
          <>
            <button onClick={handleRestore} disabled={isProcessing} className="flex items-center gap-2 px-2.5 sm:px-3 py-2 hover:bg-green-50 text-slate-600 hover:text-green-600 rounded-full transition-colors text-sm font-medium" title="Restore selected items">
              <RotateCcw size={16} /> <span className="hidden sm:inline">Restore</span>
            </button>
            <button onClick={handleDelete} disabled={isProcessing} className="flex items-center gap-2 px-2.5 sm:px-3 py-2 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-full transition-colors text-sm font-medium" title="Permanently delete selected items">
              <Trash2 size={16} /> <span className="hidden sm:inline">Delete Forever</span>
            </button>
          </>
        ) : (
          <>
            <button onClick={handleDelete} disabled={isProcessing} className="flex items-center gap-2 px-2.5 sm:px-3 py-2 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-full transition-colors text-sm font-medium" title="Delete selected items">
              <Trash2 size={16} /> <span className="hidden sm:inline">Delete</span>
            </button>
            <button onClick={onMoveRequested} disabled={isProcessing} className="flex items-center gap-2 px-2.5 sm:px-3 py-2 hover:bg-slate-100 text-slate-600 rounded-full transition-colors text-sm font-medium" title="Move selected items">
              <Folder size={16} /> <span className="hidden sm:inline">Move</span>
            </button>
            <button
              onClick={onMoveDriveRequested}
              disabled={isProcessing || !allFiles}
              className={`flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-full transition-colors text-sm font-medium ${!allFiles ? 'opacity-50 cursor-not-allowed text-slate-500' : 'hover:bg-slate-100 text-slate-600'}`}
              title={!allFiles ? 'Can only move files to another drive' : 'Move to another drive'}
            >
              <HardDrive size={16} /> <span className="hidden sm:inline">Move Drive</span>
            </button>
            <button
              onClick={onWorkspaceRequested}
              disabled={isProcessing || !allFiles}
              className={`flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-full transition-colors text-sm font-medium ${!allFiles ? 'opacity-50 cursor-not-allowed text-slate-500' : 'hover:bg-slate-100 text-slate-600'}`}
              title={!allFiles ? 'Can only add files to Workspace' : 'Add to Workspace'}
            >
              <Star size={16} /> <span className="hidden sm:inline">Workspace</span>
            </button>
          </>
        )}
      </div>
    </div>

      <ConfirmDialog
        open={confirmOpen}
        title={isTrashView ? 'Permanently delete items' : 'Delete items'}
        message={
          isTrashView
            ? `Permanently delete ${selectedItems.length} items? This action CANNOT be undone.`
            : selectedItems.some((i) => i.type === 'folder')
              ? `Delete ${selectedItems.length} items? Folders and ALL their contents will be moved to Google Drive trash.`
              : `Delete ${selectedItems.length} items?`
        }
        confirmText={isTrashView ? 'Delete Forever' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
        loading={isConfirming}
        onConfirm={confirmDelete}
        onClose={() => !isConfirming && setConfirmOpen(false)}
      />
    </>
  );
};
