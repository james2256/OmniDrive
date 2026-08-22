import { useState, useEffect } from 'react';
import { Settings, ChevronDown, ChevronUp, Lock, Calendar, Eye, EyeOff } from 'lucide-react';
import { sharedApi } from '../lib/api/shared';
import type { SharedLink } from '../types';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';
import { useToastStore } from '../stores/useToastStore';
import { toLocalDatetimeInput } from '../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

interface EditShareModalProps {
  open: boolean;
  link: SharedLink | null;
  onClose: () => void;
}

export function EditShareModal({ open, link, onClose }: EditShareModalProps) {
  const formatExpiryForInput = (iso: string | null | undefined) =>
    iso ? toLocalDatetimeInput(new Date(iso)) : '';

  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState(formatExpiryForInput(link?.expiresAt));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(link?.allowDownloads ?? true);
  const [maxDownloads, setMaxDownloads] = useState(
    link?.maxDownloads ? String(link.maxDownloads) : '',
  );
  const [webhookUrl, setWebhookUrl] = useState(link?.webhookUrl || '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToastStore();
  const invalidateSharedLinks = useInvalidateSharedLinks();

  useEffect(() => {
    if (open && link) {
      setPassword('');
      setExpiresAt(formatExpiryForInput(link.expiresAt));
      setShowAdvanced(false);
      setShowPassword(false);
      setAllowDownloads(link.allowDownloads ?? true);
      setMaxDownloads(link.maxDownloads ? String(link.maxDownloads) : '');
      setWebhookUrl(link.webhookUrl || '');
      setError('');
    }
  }, [open, link]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link) return;
    setLoading(true);
    setError('');
    try {
      let isoExpiresAt = undefined;
      if (expiresAt) {
        const [datePart, timePart] = expiresAt.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        isoExpiresAt = new Date(year, month - 1, day, hour, minute).toISOString();
      }

      await sharedApi.updateSharedLink(link.id, {
        password: password === '' ? null : password,
        expiresAt: expiresAt ? isoExpiresAt : null,
        allowDownloads,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
        webhookUrl: webhookUrl || undefined,
      });

      invalidateSharedLinks();
      addToast('success', 'Shared link settings updated successfully');
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update shared link');
    } finally {
      setLoading(false);
    }
  };

  const currentDateTime = toLocalDatetimeInput(new Date());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden max-h-[85vh]">
        <DialogHeader icon={<Settings size={20} className="text-primary" />}>
          <DialogTitle>Edit Settings</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {error && (
            <div className="text-red-500 mb-3 text-sm bg-red-50 p-2 rounded-lg border border-red-100">
              {error}
            </div>
          )}
          <form onSubmit={handleUpdate} className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                <Lock size={12} className="text-slate-400" /> New Password (optional)
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Leave blank to keep current password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                <Calendar size={12} className="text-slate-400" /> Expiration (optional)
              </label>
              <Input
                type="datetime-local"
                value={expiresAt}
                min={currentDateTime}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="gap-0 text-xs text-slate-500 hover:text-slate-700 py-1 hover:bg-transparent px-0 rounded-none"
            >
              <Settings size={12} className="mr-1" />
              Advanced
              {showAdvanced ? (
                <ChevronUp size={12} className="ml-1" />
              ) : (
                <ChevronDown size={12} className="ml-1" />
              )}
            </Button>
            <div
              className={`grid transition-[grid-template-rows] duration-200 ${showAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
              <div className="overflow-hidden">
                <div className="flex flex-col gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowDownloads}
                      onChange={(e) => setAllowDownloads(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-400 text-primary focus-visible:ring-primary cursor-pointer"
                    />
                    <span className="select-none">Allow downloads</span>
                  </label>
                  <Input
                    type="number"
                    min="1"
                    value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    placeholder="Max downloads (blank = unlimited)"
                  />
                  <Input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="Webhook URL (optional)"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" loading={loading}>
                Save Settings
              </Button>
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
