import { useState, useEffect } from 'react';
import { foldersApi } from '../../lib/api/folders';
import type { WorkspaceFolder, FileEntry } from '../../types';
import { Folder } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/Button';

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
      foldersApi.getWorkspaceTree().then((res) => setFolders(res.folders));
    }
  }, [open]);

  const handleAdd = async () => {
    if (!selectedId || !file) return;
    try {
      await foldersApi.addFilesToWorkspace(selectedId, [file.id]);
      onSuccess();
    } catch {
      // Error handled by parent
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden max-h-[85vh]">
        <DialogHeader icon={<Folder size={20} className="text-primary" />}>
          <DialogTitle>Add to Workspace</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="overflow-y-auto flex-1 space-y-1.5 max-h-[50vh]">
            {folders.map((folder) => (
              // eslint-disable-next-line no-restricted-syntax -- folder picker row (custom list item, not an action button)
              <button
                key={folder.id}
                onClick={() => setSelectedId(folder.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${selectedId === folder.id ? 'bg-blue-100' : 'hover:bg-slate-50'}`}
              >
                <Folder size={16} className="text-blue-500" />
                {folder.name}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selectedId}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
