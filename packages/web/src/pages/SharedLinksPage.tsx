import { useState } from 'react';
import {
  Link as LinkIcon,
  Folder,
  Eye,
  Download,
  Trash2,
  Copy,
  Check,
  Clock,
  Settings,
} from 'lucide-react';
import { useToastStore } from '../stores/useToastStore';
import { EditShareModal } from '../components/EditShareModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { FileIcon } from '../components/files/FileIcon';
import { useSharedLinks, useRevokeSharedLink } from '../hooks/useSharedLinks';
import { useClipboard } from '../hooks/useClipboard';
import { EmptyState, ListSkeleton } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import type { SharedLink } from '../types';
import { formatAbsoluteDate } from '../lib/utils';

export function SharedLinksPage() {
  const { data: links = [], isLoading, error, refetch } = useSharedLinks();
  const { copiedId, copy } = useClipboard();
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
    copy(`${window.location.origin}/shared/${id}`, id);
    addToast('success', 'Link copied to clipboard');
  };

  return (
    <div className="p-4 sm:p-6 space-y-2">
      <PageHeader
        title="Shared Links"
        icon={LinkIcon}
        description="Manage files and folders you have shared with others"
      />

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : links.length === 0 ? (
        <EmptyState
          icon={LinkIcon}
          title="No active shared links"
          description="Right-click any file or folder to create a shareable link."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {links.map((link) => (
            <div
              key={link.id}
              className="group bg-card rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col"
            >
              <div className="p-4 sm:p-5 border-b border-slate-100 flex-1">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div
                      className={`p-3 rounded-xl flex-shrink-0 text-2xl ${link.targetType === 'folder' ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-50'}`}
                    >
                      {link.targetType === 'folder' ? (
                        <Folder size={24} />
                      ) : (
                        <FileIcon mimeType={link.targetMimeType} />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="text-slate-900 font-semibold truncate text-lg"
                        title={link.targetName || link.targetId}
                      >
                        {link.targetName ||
                          'Unknown ' + (link.targetType === 'folder' ? 'Folder' : 'File')}
                      </h3>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <Clock size={12} />
                        <span>Created {formatAbsoluteDate(link.createdAt)}</span>
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
                <Button
                  variant="secondary"
                  onClick={() => copyToClipboard(link.id)}
                  className="justify-center flex-1 py-2 px-4 rounded-lg border-slate-200 hover:bg-slate-50 hover:text-primary hover:border-blue-200"
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
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setEditingLink(link)}
                  className="p-2 rounded-lg text-slate-500 hover:text-primary hover:bg-primary/10"
                  title="Edit Settings"
                >
                  <Settings size={18} />
                </Button>
                <Button
                  variant="ghostDanger"
                  onClick={() => revoke(link.id)}
                  className="p-2 rounded-lg"
                  title="Stop Sharing"
                >
                  <Trash2 size={18} />
                </Button>
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
