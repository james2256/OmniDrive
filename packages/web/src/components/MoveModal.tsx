import { useEffect, useState, useCallback } from 'react';
import { useToastStore } from '../stores/useToastStore';
import { api } from '../lib/api';
import type { DriveFolder, BreadcrumbItem } from '../types';
import type { SelectedItem } from '../stores/useSelectionStore';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Folder, ChevronRight, LoaderCircle, FolderInput } from 'lucide-react';

interface MoveModalProps {
  open: boolean;
  items: SelectedItem[];
  driveId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveModal({ open, items, driveId, onClose, onSuccess }: MoveModalProps) {
  const { addToast } = useToastStore();
  const [currentFolderId, setCurrentFolderId] = useState('root');
  const [subfolders, setSubfolders] = useState<DriveFolder[]>([]);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ id: 'root', name: 'My Drive' }]);
  const [isMoving, setIsMoving] = useState(false);

  const fetchFolders = useCallback(async () => {
    if (!open || !driveId) return;
    try {
      const data = await api.getDriveFolderContents(driveId, currentFolderId);
      setSubfolders(data.subfolders || []);
      setBreadcrumb(data.breadcrumb || [{ id: 'root', name: 'My Drive' }]);
    } catch {
      setSubfolders([]);
    }
  }, [open, driveId, currentFolderId]);

  useEffect(() => {
    fetchFolders();
  }, [fetchFolders]);

  // Reset navigation to root each time the modal opens so stale location
  // from a previous move doesn't persist.
  useEffect(() => {
    if (open) {
      setCurrentFolderId('root');
      setBreadcrumb([{ id: 'root', name: 'My Drive' }]);
    }
  }, [open]);

  const handleMove = async () => {
    setIsMoving(true);
    let success = 0;
    let failed = 0;

    for (const item of items) {
      try {
        if (item.type === 'file') {
          const file = item.item as { id: string; googleParentId?: string | null };
          await api.moveToFolder(driveId, file.id, currentFolderId, file.googleParentId ?? null, false);
        } else {
          const folder = item.item;
          if ('googleFolderId' in folder) {
            await api.moveToFolder(driveId, folder.googleFolderId, currentFolderId, folder.googleParentId ?? null, true);
          }
        }
        success++;
      } catch {
        failed++;
      }
    }

    setIsMoving(false);
    if (failed === 0) {
      addToast('success', `Moved ${success} item${success > 1 ? 's' : ''}`);
    } else {
      addToast('error', `Moved ${success} item${success > 1 ? 's' : ''}, ${failed} failed`);
    }
    onSuccess();
    onClose();
  };

  const handleFolderClick = (folderId: string, folderName: string) => {
    setCurrentFolderId(folderId);
    setBreadcrumb(prev => [...prev, { id: folderId, name: folderName }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumb = breadcrumb.slice(0, index + 1);
    setBreadcrumb(newBreadcrumb);
    setCurrentFolderId(newBreadcrumb[newBreadcrumb.length - 1].id ?? 'root');
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isMoving && onClose()}>
      <DialogContent className="max-w-lg p-4 rounded-xl max-h-[80vh] flex flex-col">
        <DialogTitle className="text-sm font-semibold text-slate-800 mb-2">
          Move {items.length} item{items.length > 1 ? 's' : ''}
        </DialogTitle>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 py-1.5 text-xs text-slate-600 border-b border-slate-100 shrink-0 overflow-x-auto">
          {breadcrumb.map((item, i) => (
            <span key={item.id ?? `bc-${i}`} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <ChevronRight size={12} className="text-slate-500" />}
              {i < breadcrumb.length - 1 ? (
                <button onClick={() => handleBreadcrumbClick(i)} className="hover:text-slate-900 hover:underline">
                  {item.name}
                </button>
              ) : (
                <span className="font-medium text-slate-800">{item.name}</span>
              )}
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto py-1 min-h-[160px]">
          {subfolders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Folder size={28} className="mb-1.5" />
              <p className="text-xs">No subfolders here</p>
            </div>
          ) : (
            subfolders.map((folder) => (
              <button
                key={folder.googleFolderId}
                onClick={() => handleFolderClick(folder.googleFolderId, folder.name)}
                className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors text-left"
              >
                <FolderInput size={16} className="text-slate-500 shrink-0" />
                <span className="text-sm text-slate-700 truncate">{folder.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-2 border-t border-slate-100 shrink-0">
          <span className="text-xs text-slate-500 truncate">
            → {breadcrumb[breadcrumb.length - 1]?.name || 'My Drive'}
          </span>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={onClose}
              disabled={isMoving}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleMove}
              disabled={isMoving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {isMoving ? <LoaderCircle size={14} className="animate-spin" /> : null}
              {isMoving ? 'Moving...' : 'Move here'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
