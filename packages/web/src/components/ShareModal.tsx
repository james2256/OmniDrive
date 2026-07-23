import { useState, useEffect, useRef } from 'react';
import { Copy, Check, Share2, Calendar, Lock, Settings, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { createSharedLink } from '../lib/api';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

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
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

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
      setCopied(false);
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
        // expiresAt is in "YYYY-MM-DDThh:mm" format.
        // Manually parse it to avoid browser-specific quirks where it might be parsed as UTC.
        const [datePart, timePart] = expiresAt.split('T');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        // new Date(year, monthIndex, day, hours, minutes) explicitly creates a local date.
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

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(sharedUrl);
      setCopied(true);
      setError('');
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
      setError('Failed to copy to clipboard');
    }
  };

  const currentDateTime = new Date().toISOString().slice(0, 16);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-4 rounded-xl max-h-[85vh] overflow-y-auto">
        <DialogTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
          <Share2 size={16} className="text-blue-500" />
          Share {targetType === 'file' ? 'File' : 'Folder'}
        </DialogTitle>
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
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Leave blank for no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  className="w-full px-3 py-1.5 pr-9 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600 flex items-center gap-1">
                <Calendar size={12} className="text-slate-400" /> Expiration (optional)
              </label>
              <input
                type="datetime-local"
                value={expiresAt}
                min={currentDateTime}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors py-1"
            >
              <Settings size={12} className="mr-1" />
              Advanced
              {showAdvanced ? <ChevronUp size={12} className="ml-1" /> : <ChevronDown size={12} className="ml-1" />}
            </button>
            <div className={`grid transition-[grid-template-rows] duration-200 ${showAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                <div className="flex flex-col gap-2 pt-1">
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowDownloads}
                      onChange={(e) => setAllowDownloads(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="select-none">Allow downloads</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireEmail}
                      onChange={(e) => setRequireEmail(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="select-none">Require email to view</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={maxDownloads}
                    onChange={(e) => setMaxDownloads(e.target.value)}
                    placeholder="Max downloads (blank = unlimited)"
                    className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="Webhook URL (optional)"
                    className="w-full px-3 py-1.5 bg-card border border-slate-400 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex items-center justify-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={loading}
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Create Link'
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-slate-600 bg-blue-50 p-2 rounded-lg border border-blue-100">
              Anyone with this link can access the {targetType}.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={sharedUrl}
                className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none"
                onClick={(e) => e.currentTarget.select()}
              />
              <button
                className="flex items-center justify-center w-9 h-9 text-slate-700 bg-card border border-slate-400 rounded-lg hover:bg-slate-50 transition-colors shrink-0"
                onClick={copyToClipboard}
                title="Copy to clipboard"
              >
                {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
              </button>
            </div>
            <div className="flex justify-end mt-2">
              <button
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
