import { useState, useEffect } from 'react';
import { Settings, ChevronDown, ChevronUp, Lock, Calendar, Eye, EyeOff } from 'lucide-react';
import { updateSharedLink } from '../lib/api';
import type { SharedLink } from '../lib/api';
import { useInvalidateSharedLinks } from '../hooks/useSharedLinks';
import { useToastStore } from '../stores/useToastStore';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

interface EditShareModalProps {
  open: boolean;
  link: SharedLink | null;
  onClose: () => void;
}

export function EditShareModal({ open, link, onClose }: EditShareModalProps) {
  // Extract datetime-local suitable string from ISO date string
  const getInitialDate = (isoString: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    // Adjust to local timezone for datetime-local input
    const offset = date.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
    return localISOTime;
  };

  // We don't load the password_hash, we just allow setting a new password.
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState(getInitialDate(link?.expiresAt ?? null));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(link?.allowDownloads ?? true);
  const [allowUploads, setAllowUploads] = useState(link?.allowUploads ?? false);
  const [maxDownloads, setMaxDownloads] = useState(link?.maxDownloads ? String(link.maxDownloads) : '');
  const [requireEmail, setRequireEmail] = useState(link?.requireEmail ?? false);
  const [webhookUrl, setWebhookUrl] = useState(link?.webhookUrl || '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToastStore();
  const invalidateSharedLinks = useInvalidateSharedLinks();

  // Re-read all settings from `link` each time the modal opens so switching
  // between links doesn't show the previous link's stale form state.
  useEffect(() => {
    if (open && link) {
      setPassword('');
      setExpiresAt(getInitialDate(link.expiresAt ?? null));
      setShowAdvanced(false);
      setShowPassword(false);
      setAllowDownloads(link.allowDownloads ?? true);
      setAllowUploads(link.allowUploads ?? false);
      setMaxDownloads(link.maxDownloads ? String(link.maxDownloads) : '');
      setRequireEmail(link.requireEmail ?? false);
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

      await updateSharedLink(link.id, {
        password: password === '' ? null : password,
        expiresAt: expiresAt ? isoExpiresAt : null, // send null if explicitly cleared
        allowDownloads,
        allowUploads: link.targetType === 'folder' ? allowUploads : false,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
        requireEmail,
        webhookUrl: webhookUrl || undefined
      });

      invalidateSharedLinks();
      addToast('success', 'Shared link settings updated successfully');
      onClose();
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : 'Failed to update shared link'));
    } finally {
      setLoading(false);
    }
  };

  const currentDateTime = new Date().toISOString().slice(0, 16);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md p-4 rounded-xl max-h-[85vh] overflow-y-auto">
        <DialogTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2 mb-3">
          <Settings size={16} className="text-blue-500" />
          Edit Settings
        </DialogTitle>
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
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Leave blank to keep current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
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
                {link?.targetType === 'folder' && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowUploads}
                      onChange={(e) => setAllowUploads(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <span className="select-none">Allow uploads (public drop folder)</span>
                  </label>
                )}
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
                'Save Settings'
              )}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
