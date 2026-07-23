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
    if (open) {
      setSelectedId(null);
      api.getWorkspaceTree().then(res => setFolders(res.folders));
    }
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
      <DialogContent className="max-w-md p-4 rounded-xl">
        <DialogTitle className="text-sm font-semibold text-slate-800 mb-3">Add to Workspace</DialogTitle>
        <div className="overflow-y-auto flex-1 space-y-1.5 max-h-[50vh]">
          {folders.map(folder => (
            <button
              key={folder.id}
              onClick={() => setSelectedId(folder.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${selectedId === folder.id ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
            >
              <Folder size={16} className="text-blue-500" />
              {folder.name}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleAdd} disabled={!selectedId} className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">Add</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
