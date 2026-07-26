import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogTitle } from './ui/dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Pen } from 'lucide-react';

interface RenameDialogProps {
  open: boolean;
  initialName: string;
  title: string;
  onConfirm: (newName: string) => void;
  onClose: () => void;
  loading?: boolean;
}

export function RenameDialog({ open, initialName, title, onConfirm, onClose, loading = false }: RenameDialogProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && name !== initialName) {
      onConfirm(name.trim());
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-sm p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader icon={<Pen size={20} className="text-primary" />}>
          <DialogTitle className="text-sm font-semibold text-slate-800">{title}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit}>
            <Input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new name"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading || !name.trim() || name === initialName} loading={loading}>Rename</Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
