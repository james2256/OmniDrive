import { useState, useEffect, useRef } from 'react';
import { Copy, Check, Share2, Calendar, Lock, Settings, ChevronDown, ChevronUp } from 'lucide-react';
import { createSharedLink } from '../lib/api';
import { useSharedStore } from '../stores/sharedStore';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

interface ShareModalProps {
  open: boolean;
  targetType: 'file' | 'folder';
  targetId: string;
  onClose: () => void;
}

export function ShareModal({ open, targetType, targetId, onClose }: ShareModalProps) {
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [allowUploads, setAllowUploads] = useState(false);
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
        allowUploads: targetType === 'folder' ? allowUploads : false,
        maxDownloads: maxDownloads ? parseInt(maxDownloads, 10) : null,
        requireEmail,
        webhookUrl: webhookUrl || undefined
      });
      setSharedUrl(resp.url);
      useSharedStore.getState().fetchSharedLinks();
    } catch (err: any) {
      setError(err.message || 'Failed to create shared link');
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
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 rounded-2xl overflow-hidden flex flex-col max-h-full">
        <div className="flex items-center p-5 border-b border-stone-100 shrink-0">
          <DialogTitle className="text-lg font-semibold text-stone-800 flex items-center gap-2">
            <Share2 size={20} className="text-blue-500" />
            Share {targetType === 'file' ? 'File' : 'Folder'}
          </DialogTitle>
        </div>

        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="text-red-500 mb-4 text-sm bg-red-50 p-3 rounded-lg border border-red-100">
              {error}
            </div>
          )}

          {!sharedUrl ? (
            <form onSubmit={handleShare} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700 flex items-center gap-1.5">
                  <Lock size={14} className="text-stone-400" /> Password (optional)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank for no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="px-3 py-2 bg-card border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-stone-700 flex items-center gap-1.5">
                  <Calendar size={14} className="text-stone-400" /> Expiration Date (optional)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  min={currentDateTime}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="px-3 py-2 bg-card border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
                />
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center text-sm font-medium text-stone-600 hover:text-stone-800 transition-colors"
                >
                  <Settings size={14} className="mr-1.5" />
                  Advanced Settings
                  {showAdvanced ? <ChevronUp size={14} className="ml-1" /> : <ChevronDown size={14} className="ml-1" />}
                </button>

                <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showAdvanced ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-3 mt-3 p-4 bg-stone-50 rounded-xl border border-stone-200">
                      <label className="flex items-center gap-2.5 text-sm text-stone-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowDownloads}
                          onChange={(e) => setAllowDownloads(e.target.checked)}
                          className="w-4 h-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="select-none">Allow Downloads</span>
                      </label>

                      {targetType === 'folder' && (
                        <label className="flex items-center gap-2.5 text-sm text-stone-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allowUploads}
                            onChange={(e) => setAllowUploads(e.target.checked)}
                            className="w-4 h-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                          <span className="select-none">Allow Uploads (Public Drop folder)</span>
                        </label>
                      )}

                      <label className="flex items-center gap-2.5 text-sm text-stone-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requireEmail}
                          onChange={(e) => setRequireEmail(e.target.checked)}
                          className="w-4 h-4 rounded border-stone-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                        />
                        <span className="select-none">Require Email to View</span>
                      </label>

                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Max Downloads</label>
                        <input
                          type="number"
                          min="1"
                          value={maxDownloads}
                          onChange={(e) => setMaxDownloads(e.target.value)}
                          placeholder="e.g. 10 (Leave blank for unlimited)"
                          className="px-3 py-2 bg-card border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      <div className="flex flex-col gap-1.5 mt-2">
                        <label className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Webhook URL</label>
                        <input
                          type="url"
                          value={webhookUrl}
                          onChange={(e) => setWebhookUrl(e.target.value)}
                          placeholder="e.g. https://your-api.com/webhook"
                          className="px-3 py-2 bg-card border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-stone-100">
                <button
                  type="button"
                  className="px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex items-center justify-center min-w-[100px] px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
            <div className="flex flex-col gap-4">
              <p className="text-sm text-stone-600 bg-blue-50 p-3 rounded-lg border border-blue-100">
                Anyone with this link can access the {targetType}.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={sharedUrl}
                  className="flex-1 px-3 py-2 bg-stone-50 border border-stone-200 rounded-lg text-sm text-stone-600 focus:outline-none"
                  onClick={(e) => e.currentTarget.select()}
                />
                <button
                  className="flex items-center justify-center w-10 h-10 text-stone-700 bg-card border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors shrink-0"
                  onClick={copyToClipboard}
                  title="Copy to clipboard"
                >
                  {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                </button>
              </div>
              <div className="flex justify-end mt-4 pt-4 border-t border-stone-100">
                <button
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                  onClick={onClose}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
