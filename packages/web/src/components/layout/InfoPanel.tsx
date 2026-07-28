import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSelectionStore } from '../../stores/useSelectionStore';
import { formatFileSize, formatRelativeTime } from '../../lib/utils';
import type { FileEntry } from '../../types';
import { foldersApi } from '../../lib/api/folders';
import { filesApi } from '../../lib/api/files';
import { invalidateAfterFileMutation } from '../../lib/invalidate';
import { FileIcon, getFileTypeName } from '../files/FileIcon';
import { DriveBadge } from '../DriveBadge';
import { X, File, Folder, RefreshCw } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useToastStore } from '../../stores/useToastStore';
import { useDrives } from '../../hooks/useDrives';
import { Button } from '../ui/Button';

/** Parse metadata (string or object) into a Record, returning {} on malformed JSON. */
function parseMetadata(raw: string | Record<string, string> | undefined): Record<string, string> {
  if (!raw) return {};
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const InfoPanel: React.FC = () => {
  const selectedItems = useSelectionStore((s) => s.selectedItems);
  const isInfoPanelOpen = useUIStore((s) => s.isInfoPanelOpen);
  const toggleInfoPanel = useUIStore((s) => s.toggleInfoPanel);

  // Hooks must be called unconditionally (moved here from after early returns —
  // the original code had a hooks violation where useState/useToastStore were
  // only called when selectedItems.length === 1).
  const [isSyncing, setIsSyncing] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const { data: drivesData } = useDrives();
  const drives = drivesData?.drives ?? [];

  const singleSelection = selectedItems.length === 1 ? selectedItems[0] : null;
  const { type, item } = singleSelection ?? { type: 'file' as const, item: null };

  const handleForceSync = async () => {
    if (!singleSelection || singleSelection.type !== 'folder') return;
    setIsSyncing(true);
    try {
      const driveId =
        (singleSelection.item as unknown as FileEntry & { driveAccountId?: string })
          .driveAccountId || '';
      await foldersApi.forceSyncFolder(singleSelection.item.id || '', driveId);
      addToast('success', 'Sync queued. Data will update shortly.');
      invalidateAfterFileMutation(queryClient);
    } catch (err: unknown) {
      addToast('error', err instanceof Error ? err.message : 'Failed to queue sync.');
    } finally {
      setIsSyncing(false);
    }
  };

  const renderContent = () => {
    if (selectedItems.length === 0) {
      return (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Details</h2>
            <Button
              onClick={toggleInfoPanel}
              variant="ghost"
              className="p-1.5 rounded-full text-slate-500"
              aria-label="Close panel"
            >
              <X size={18} />
            </Button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <File size={48} className="text-slate-300 mb-4" />
            <p className="text-sm text-slate-500">
              Select a file or folder to see its details here.
            </p>
          </div>
        </>
      );
    }

    if (selectedItems.length > 1) {
      return (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-slate-800">Details</h2>
            <Button
              onClick={toggleInfoPanel}
              variant="ghost"
              className="p-1.5 rounded-full text-slate-500"
              aria-label="Close panel"
            >
              <X size={18} />
            </Button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <File size={48} className="text-slate-300 mb-4" />
            <p className="text-sm text-slate-800 font-medium">
              {selectedItems.length} items selected
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Select a single item to view its properties.
            </p>
          </div>
        </>
      );
    }

    const driveAccountId =
      item && 'driveAccountId' in item && item.driveAccountId ? item.driveAccountId : undefined;
    const driveIndex = driveAccountId ? drives.findIndex((d) => d.id === driveAccountId) : -1;
    const driveAccount = driveIndex >= 0 ? drives[driveIndex] : null;

    // Single item selected
    return (
      <>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-slate-800">Details</h2>
          <Button
            onClick={toggleInfoPanel}
            variant="ghost"
            className="p-1.5 rounded-full text-slate-500"
            aria-label="Close panel"
          >
            <X size={18} />
          </Button>
        </div>

        <div className="mb-6 flex justify-center">
          {type === 'folder' ? (
            <div className="w-24 h-24 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Folder size={48} className="text-blue-500" fill="currentColor" />
            </div>
          ) : (
            <div className="w-24 h-24 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center text-5xl shadow-sm">
              <FileIcon mimeType={item?.mimeType} />
            </div>
          )}
        </div>

        <h3 className="text-base font-medium text-slate-800 text-center mb-6 break-words px-2">
          {item?.name}
        </h3>

        <div className="space-y-4">
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Properties
            </h4>
            <dl className="space-y-3 text-sm">
              {driveAccount && (
                <div className="flex flex-col">
                  <dt className="text-slate-500 mb-1 text-xs">Stored on</dt>
                  <dd>
                    <DriveBadge email={driveAccount.email} colorIndex={driveIndex} size="md" />
                  </dd>
                </div>
              )}
              <div className="flex flex-col">
                <dt className="text-slate-500 mb-0.5 text-xs">Type</dt>
                <dd className="text-slate-800">
                  {type === 'folder' ? 'Folder' : getFileTypeName(item?.mimeType)}
                </dd>
              </div>
              {type === 'file' && (
                <div className="flex flex-col">
                  <dt className="text-slate-500 mb-0.5 text-xs">Size</dt>
                  <dd className="text-slate-800">{formatFileSize(item?.size ?? 0)}</dd>
                </div>
              )}
              <div className="flex flex-col">
                <dt className="text-slate-500 mb-0.5 text-xs">Modified</dt>
                <dd className="text-slate-800">
                  {type === 'file'
                    ? formatRelativeTime(item?.googleModifiedAt ?? item?.createdAt ?? '')
                    : '—'}
                </dd>
              </div>
              {type === 'file' && item?.googleCreatedAt && (
                <div className="flex flex-col">
                  <dt className="text-slate-500 mb-0.5 text-xs">Created</dt>
                  <dd className="text-slate-800">
                    {formatRelativeTime(item?.googleCreatedAt ?? '')}
                  </dd>
                </div>
              )}
              {type === 'folder' && item && 'lastSyncedAt' in item && (
                <div className="flex flex-col">
                  <dt className="text-slate-500 mb-0.5 text-xs">Last Synced</dt>
                  <dd className="text-slate-800">
                    {(
                      item as unknown as FileEntry & { workspaceId?: string; lastSyncedAt?: string }
                    ).lastSyncedAt
                      ? formatRelativeTime(
                          (
                            item as unknown as FileEntry & {
                              workspaceId?: string;
                              lastSyncedAt?: string;
                            }
                          ).lastSyncedAt,
                        )
                      : 'Never'}
                  </dd>
                </div>
              )}
            </dl>

            {type === 'folder' && (
              <div className="mt-4">
                <Button
                  onClick={handleForceSync}
                  disabled={isSyncing}
                  variant="primary"
                  size="md"
                  className="w-full justify-center rounded-lg"
                  loading={isSyncing}
                >
                  {!isSyncing && <RefreshCw size={16} />}
                  {isSyncing ? 'Syncing...' : 'Force Sync'}
                </Button>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
              Tags & Metadata
            </h4>
            {item && 'metadata' in item && item.metadata ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(
                  parseMetadata(
                    (item as unknown as FileEntry & { workspaceId?: string; lastSyncedAt?: string })
                      .metadata,
                  ),
                ).map(([k, v]) => (
                  <div
                    key={k}
                    className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center"
                  >
                    <span className="font-semibold mr-1">{k}:</span> {v as string}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 mb-3">No tags applied.</p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const key = (form.elements.namedItem('metaKey') as HTMLInputElement).value;
                const value = (form.elements.namedItem('metaValue') as HTMLInputElement).value;
                if (!key || !value || !item) return;

                const currentMeta = parseMetadata(
                  (item as unknown as FileEntry & { workspaceId?: string; lastSyncedAt?: string })
                    .metadata,
                );
                const newMeta = { ...currentMeta, [key]: value };

                try {
                  if (type === 'file') {
                    await filesApi.updateFileMetadata(item.id || '', newMeta);
                  } else if (
                    (item as unknown as FileEntry & { workspaceId?: string; lastSyncedAt?: string })
                      .workspaceId
                  ) {
                    await filesApi.updateFolderMetadata(
                      (
                        item as unknown as FileEntry & {
                          workspaceId?: string;
                          lastSyncedAt?: string;
                        }
                      ).workspaceId,
                      item.id || '',
                      newMeta,
                    );
                  }
                  addToast('success', 'Metadata updated');
                  form.reset();
                  invalidateAfterFileMutation(queryClient);
                } catch {
                  addToast('error', 'Failed to update metadata');
                }
              }}
              className="flex gap-2"
            >
              <input
                name="metaKey"
                placeholder="Key"
                className="w-1/3 border border-slate-400 rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <input
                name="metaValue"
                placeholder="Value"
                className="flex-1 border border-slate-400 rounded px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <Button
                type="submit"
                variant="primary"
                className="bg-slate-800 px-2 py-1 rounded text-xs"
              >
                Add
              </Button>
            </form>
          </div>
        </div>
      </>
    );
  };

  return (
    <>
      {/* Mobile: overlay backdrop */}
      {isInfoPanelOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={toggleInfoPanel}
          aria-hidden
        />
      )}
      <aside
        className={`bg-card border-l border-slate-200 h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out z-50 ${
          // Mobile: fixed drawer from right; Desktop: inline collapsible panel
          isInfoPanelOpen
            ? 'fixed right-0 top-16 bottom-0 w-[88%] max-w-sm shadow-xl md:relative md:top-0 md:shadow-none md:w-80 md:max-w-none'
            : 'w-0 md:w-0'
        }`}
        aria-hidden={!isInfoPanelOpen}
      >
        {/* Fixed-width inner wrapper so content stays put while the aside width animates */}
        <div
          className={`w-[88%] max-w-sm md:w-80 h-full flex flex-col p-4 overflow-y-auto transition-opacity duration-200 ${
            isInfoPanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {renderContent()}
        </div>
      </aside>
    </>
  );
};
