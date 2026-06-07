import { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Share2, Calendar, Lock } from 'lucide-react';
import { createSharedLink } from '../lib/api';

interface ShareModalProps {
  targetType: 'file' | 'folder';
  targetId: string;
  onClose: () => void;
}

export function ShareModal({ targetType, targetId, onClose }: ShareModalProps) {
  const [password, setPassword] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
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
      const resp = await createSharedLink(targetType, targetId, password || undefined, expiresAt || undefined);
      setSharedUrl(resp.url);
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
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
          <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Share2 size={20} />
            Share {targetType === 'file' ? 'File' : 'Folder'}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div>
          {error && (
            <div style={{ color: 'var(--accent-danger)', marginBottom: 'var(--space-md)', fontSize: 'var(--font-size-sm)' }}>
              {error}
            </div>
          )}

          {!sharedUrl ? (
            <form onSubmit={handleShare} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <div className="form-group">
                <label className="form-label">
                  <Lock size={14} /> Password (optional)
                </label>
                <input
                  type="password"
                  placeholder="Leave blank for no password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="form-control"
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  <Calendar size={14} /> Expiration Date (optional)
                </label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  min={currentDateTime}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="form-control"
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                <button type="button" className="btn btn-ghost" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? <div className="spinner" /> : 'Create Link'}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>
                Anyone with this link can access the {targetType}.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                <input
                  type="text"
                  readOnly
                  value={sharedUrl}
                  className="form-control"
                  style={{ flex: 1 }}
                  onClick={(e) => e.currentTarget.select()}
                />
                <button className="btn btn-secondary" onClick={copyToClipboard} title="Copy to clipboard">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                <button className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
