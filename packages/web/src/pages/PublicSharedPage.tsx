import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { getSharedMeta, verifySharedPassword } from '../lib/api';
import type { SharedMetaResponse } from '../lib/api';
import { formatFileSize } from '../lib/utils';
import { FileIcon } from '../components/files/FileIcon';
import { Lock, Download, CircleAlert, LoaderCircle, Folder } from 'lucide-react';
import { FolderDownloadModal } from '../components/FolderDownloadModal';

export function PublicSharedPage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<SharedMetaResponse | null>(null);
  const [error, setError] = useState('');

  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [folderContents, setFolderContents] = useState<{ files: Array<{ id: string; name: string; mimeType: string; size: number }>; folders: Array<{ id: string; name: string }> } | null>(null);
  const [folderDownloadOpen, setFolderDownloadOpen] = useState(false);

  const loadMeta = useCallback(async (skipLoadingState = false) => {
    if (!id) {
      setLoading(false);
      setError('Invalid link ID');
      return;
    }
    try {
      if (!skipLoadingState) setLoading(true);
      setError('');
      const data = await getSharedMeta(id);
      setMeta(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to load shared link');
    } finally {
      if (!skipLoadingState) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Fetch folder contents when meta loads (if it's a folder link and not password-gated)
  useEffect(() => {
    if (meta?.type === 'folder' && id && !meta.requiresPassword) {
      const apiUrl = import.meta.env.VITE_API_URL || '';
      fetch(`${apiUrl}/api/shared/${id}/folder-contents`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : Promise.reject(new Error('Failed to load folder')))
        .then(data => setFolderContents(data))
        .catch(() => setFolderContents(null));
    }
  }, [meta, id]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !password) return;

    try {
      setVerifying(true);
      setPasswordError('');
      await verifySharedPassword(id, password);
      await loadMeta(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPasswordError(message || 'Incorrect password');
    } finally {
      setVerifying(false);
    }
  };

  const handleDownload = () => {
    if (!id) return;
    const apiUrl = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiUrl}/api/shared/${id}/download`;
  };

  const renderContent = (): ReactNode => {
    if (loading) {
      return (
        <div className="bg-card border border-slate-200 rounded-2xl shadow-sm p-8 sm:p-10 max-w-sm w-full flex flex-col items-center text-center">
          <LoaderCircle className="animate-spin text-blue-500 mb-4" size={40} />
          <p className="text-slate-500 font-medium text-sm">Loading...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="bg-card border border-red-200 rounded-2xl shadow-sm p-8 sm:p-10 max-w-sm w-full flex flex-col items-center text-center">
          <CircleAlert size={40} className="text-red-500 mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Error</h2>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      );
    }

    if (meta?.requiresPassword) {
      return (
        <div className="bg-card border border-slate-200 rounded-2xl shadow-sm p-8 sm:p-10 max-w-sm w-full">
          <div className="flex flex-col items-center text-center mb-6">
            <Lock size={40} className="text-blue-500 mb-4" />
            <h2 className="text-xl font-bold text-slate-800 mb-1">Password Required</h2>
            <p className="text-slate-500 text-sm">This shared link is protected by a password.</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="shared-password" className="sr-only">
                Password
              </label>
              <input
                id="shared-password"
                type="password"
                autoComplete="current-password"
                className="w-full px-4 py-2.5 bg-card border border-slate-400 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>

            {passwordError && (
              <p role="alert" className="text-red-600 text-sm">
                {passwordError}
              </p>
            )}

            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white bg-blue-600 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={verifying || !password}
            >
              {verifying && <LoaderCircle className="animate-spin" size={18} />}
              Unlock
            </button>
          </form>
        </div>
      );
    }

    return (
      <div className="bg-card border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8 max-w-md w-full">
        {meta?.type === 'folder' ? (
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <Folder size={28} className="text-blue-500" fill="currentColor" />
              </div>
              <h2 className="text-lg font-bold text-slate-800 break-words">{meta?.targetName || 'Shared Folder'}</h2>
            </div>

            {/* Download All as ZIP */}
            <button
              onClick={() => setFolderDownloadOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white bg-blue-600 rounded-lg font-medium hover:bg-blue-700 transition-colors mb-4"
            >
              <Download size={18} />
              Download All as ZIP
            </button>

            {/* File list */}
            {folderContents ? (
              <div className="space-y-1 max-h-60 overflow-y-auto border border-slate-200 rounded-lg p-2">
                {folderContents.folders.length === 0 && folderContents.files.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">This folder is empty.</p>
                ) : (
                  <>
                    {folderContents.folders.map(f => (
                      <div key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50">
                        <Folder size={16} className="text-blue-400 flex-shrink-0" fill="currentColor" />
                        <span className="text-sm text-slate-700 truncate">{f.name}</span>
                      </div>
                    ))}
                    {folderContents.files.map(f => {
                      const apiUrl = import.meta.env.VITE_API_URL || '';
                      return (
                        <a
                          key={f.id}
                          href={`${apiUrl}/api/shared/${id}/download?fileId=${f.id}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 group"
                        >
                          <div className="text-base flex-shrink-0"><FileIcon mimeType={f.mimeType} /></div>
                          <span className="text-sm text-slate-700 truncate flex-1">{f.name}</span>
                          <span className="text-xs text-slate-400 flex-shrink-0">{formatFileSize(f.size)}</span>
                          <Download size={14} className="text-slate-400 group-hover:text-blue-500 flex-shrink-0" />
                        </a>
                      );
                    })}
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center py-4">
                <LoaderCircle className="animate-spin text-slate-400" size={20} />
                <span className="text-sm text-slate-500 ml-2">Loading contents...</span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <div className="mx-auto mb-4 w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center text-4xl sm:text-5xl">
              <FileIcon mimeType={meta?.target?.mimeType || null} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2 break-words">{meta?.target?.name || 'Unknown File'}</h2>
            {typeof meta?.target?.size === 'number' && (
              <p className="text-slate-500 text-sm mb-6">{formatFileSize(meta.target.size)}</p>
            )}
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white bg-blue-600 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              <Download size={18} />
              Download
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-surface p-4 sm:p-6 gap-6">
      <div className="flex items-center gap-3">
        <img src="/logo.svg" alt="OmniDrive" className="w-12 h-auto sm:w-14 object-contain flex-shrink-0" />
        <img src="/logotag.svg" alt="" aria-hidden="true" decoding="async" className="h-6 sm:h-7 w-auto flex-shrink-0" />
      </div>
      {renderContent()}
      <FolderDownloadModal
        open={folderDownloadOpen}
        onClose={() => setFolderDownloadOpen(false)}
        sharedLinkId={id}
        folderName={meta?.targetName || 'folder'}
      />
    </main>
  );
}
