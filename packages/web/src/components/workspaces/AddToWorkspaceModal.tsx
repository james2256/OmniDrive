import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { WorkspaceFolder, FileEntry } from '../../types';
import { Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';

interface Props {
  open: boolean;
  file?: FileEntry;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddToWorkspaceModal({ open, file, onClose, onSuccess }: Props) {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) api.getWorkspaceTree().then(res => setFolders(res.folders));
  }, [open]);

  const handleAdd = async () => {
    if (!selectedId || !file) return;
    try {
      await api.addFilesToWorkspace(selectedId, [file.id]);
      onSuccess();
    } catch {
      // Error handled by parent
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 rounded-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex items-center px-6 py-4 border-b border-stone-100 shrink-0">
          <DialogTitle className="text-xl font-semibold text-stone-800">Add to Workspace</DialogTitle>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {folders.map(folder => (
            <button
              key={folder.id}
              onClick={() => setSelectedId(folder.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-left transition-colors ${selectedId === folder.id ? 'bg-blue-100' : 'hover:bg-stone-50'}`}
            >
              <Folder size={16} className="text-blue-500" />
              {folder.name}
            </button>
          ))}
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-4 py-2 font-medium text-stone-700 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors">Cancel</button>
          <button onClick={handleAdd} disabled={!selectedId} className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
