import { useState, useEffect } from 'react';
import { useClipboard } from '../hooks/useClipboard';
import { Copy, Check, Share2, Calendar, Lock, Settings, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { createSharedLink } from '../lib/api';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';
import { toLocalDatetimeInput, cn } from '../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter, DialogTitle } from './ui/dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

interface ShareModalProps {
  open: boolean;
  targetType: 'file' | 'folder';
  targetId: string;
  onClose: () => void;
}

export function ShareModal({ open, targetType, targetId, onClose }: ShareModalProps) {
  const invalidateSharedLinks = useInvalidateSharedLinks();
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [maxDownloads, setMaxDownloads] = useState('');
  const [requireEmail, setRequireEmail] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sharedUrl, setSharedUrl] = useState('');
  const { copiedId, copy } = useClipboard();

  // Reset form state each time the modal opens so stale input/URL don't persist.
  useEffect(() => {
    if (open) {
      setPassword('');
      setExpiresAt('');
      setShowAdvanced(false);
      setShowPassword(false);
      setAllowDownloads(true);
      setMaxDownloads('');
      setRequireEmail(false);
      setWebhookUrl('');
      setSharedUrl('');
      setError('');
    }
  }, [open]);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const resp = await createSharedLink({
        targetType,
        targetId,
        password: password || undefined,
        expiresAt: isoExpiresAt,
        allowDownloads,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
        requireEmail,
        webhookUrl: webhookUrl || undefined
      });
      setSharedUrl(resp.url);
      invalidateSharedLinks();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : 'Failed to create shared link'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => copy(sharedUrl, 'share-modal');

  const currentDateTime = toLocalDatetimeInput(new Date());

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 flex flex-col overflow-hidden max-h-[85vh]">
        <DialogHeader icon={<Share2 size={20} className="text-primary" />}>
          <DialogTitle>
            Share {targetType === 'file' ? 'File' : 'Folder'}
          </DialogTitle>
        </DialogHeader>
        <DialogBody>
          {error && (
            <div className="text-red-500 mb-3 text-sm bg-red-50 p-2 rounded-lg border border-red-100">
              {error}
            </div>
          )}
          {!sharedUrl ? (
            <form onSubmit={handleShare} className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <Lock size={12} className="text-slate-400" /> Password (optional)
                </label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Leave blank for no password"
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
                {showAdvanced ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />}
              </Button>
              <div className={`grid transition-[grid-template-rows] duration-200 ${showAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
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
                    <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={requireEmail}
                        onChange={(e) => setRequireEmail(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-400 text-primary focus-visible:ring-primary cursor-pointer"
                      />
                      <span className="select-none">Require email to view</span>
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
                <Button variant="secondary" type="button" onClick={onClose} disabled={loading}>Cancel</Button>
                <Button type="submit" loading={loading}>Create Link</Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-600 bg-primary/10 p-2 rounded-lg border border-blue-100">
                Anyone with this link can access the {targetType}.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={sharedUrl}
                  className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 focus-visible:outline-none"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="secondary"
                  className={cn('w-9 h-9 justify-center p-0 shrink-0')}
                  onClick={handleCopy}
                  title="Copy to clipboard"
                >
                  {copiedId === 'share-modal' ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={onClose}>Done</Button>
              </DialogFooter>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
