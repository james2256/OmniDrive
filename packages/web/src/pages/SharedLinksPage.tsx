import { useState } from 'react';
import { Link as LinkIcon, Folder, Eye, Download, Trash2, Copy, Check, Clock, Settings } from 'lucide-react';
import { useToastStore } from '../stores/useToastStore';
import { EditShareModal } from '../components/EditShareModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FileIcon } from '../components/files/FileIcon';
import { useSharedLinks, useRevokeSharedLink } from '../hooks/useSharedLinks';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import type { SharedLink } from '../lib/api';

export function SharedLinksPage() {
  const { data: links = [], isLoading } = useSharedLinks();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingLink, setEditingLink] = useState<SharedLink | null>(null);
  const { addToast } = useToastStore();
  const revokeMut = useRevokeSharedLink();
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);

  const revoke = (id: string) => {
    setRevokeTargetId(id);
  };

  const confirmRevoke = () => {
    if (!revokeTargetId) return;
    revokeMut.mutate(revokeTargetId);
    setRevokeTargetId(null);
  };

  const copyToClipboard = (id: string) => {
    const url = `${window.location.origin}/shared/${id}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    addToast('success', 'Link copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(dateString));
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
          <LinkIcon className="text-primary" size={32} />
          Shared Links
        </h1>
        <p className="text-slate-500 mt-2 text-lg">
          Manage files and folders you have shared with others.
        </p>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : links.length === 0 ? (
        <EmptyState
          icon={LinkIcon}
          title="No active shared links"
          description="Right-click any file or folder to create a shareable link."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {links.map((link) => (
            <div
              key={link.id}
              className="group bg-card rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col"
            >
              <div className="p-5 border-b border-slate-100 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className={`p-3 rounded-xl flex-shrink-0 text-2xl ${link.targetType === 'folder' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50'}`}>
                      {link.targetType === 'folder' ? <Folder size={24} /> : <FileIcon mimeType={link.targetMimeType} />}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-slate-900 font-semibold truncate text-lg" title={link.targetName || link.targetId}>
                        {link.targetName || 'Unknown ' + (link.targetType === 'folder' ? 'Folder' : 'File')}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <Clock size={12} />
                        <span>Created {formatDate(link.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 py-3 px-4 bg-slate-50 rounded-xl mt-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Eye size={16} className="text-slate-500" />
                    <span className="font-medium">{link.viewCount}</span>
                    <span className="text-slate-500 text-xs uppercase tracking-wider">Views</span>
                  </div>
                  <div className="w-px h-8 bg-slate-200"></div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Download size={16} className="text-slate-500" />
                    <span className="font-medium">{link.downloadCount}</span>
                    <span className="text-slate-500 text-xs uppercase tracking-wider">DLs</span>
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 bg-slate-50 flex items-center justify-between gap-3">
                <button
                  onClick={() => copyToClipboard(link.id)}
                  className="flex items-center justify-center gap-2 flex-1 py-2 px-4 rounded-lg bg-card border border-slate-200 text-slate-700 font-medium text-sm hover:bg-slate-50 hover:text-blue-600 hover:border-blue-200 transition-colors"
                >
                  {copiedId === link.id ? (
                    <>
                      <Check size={16} className="text-green-500" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={16} />
                      <span>Copy Link</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setEditingLink(link)}
                  className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  title="Edit Settings"
                >
                  <Settings size={18} />
                </button>
                <button
                  onClick={() => revoke(link.id)}
                  className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                  title="Stop Sharing"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <EditShareModal
        open={!!editingLink}
        link={editingLink}
        onClose={() => setEditingLink(null)}
      />

      <ConfirmDialog
        open={revokeTargetId !== null}
        title="Stop Sharing"
        message="Are you sure you want to stop sharing this item?"
        confirmText="Stop Sharing"
        cancelText="Cancel"
        variant="danger"
        loading={revokeMut.isPending}
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTargetId(null)}
      />
    </div>
  );
}
