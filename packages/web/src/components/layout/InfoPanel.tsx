import React, { useState } from 'react';
import { useSelectionStore } from '../../stores/useSelectionStore';
import { formatFileSize, formatRelativeTime } from '../../lib/utils';
import { FileIcon } from '../files/FileIcon';
import { DriveBadge } from '../DriveBadge';
import { X, File, Folder, Loader2, RefreshCw } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';
import { useToastStore } from '../../stores/toastStore';
import { useDriveStore } from '../../stores/driveStore';

export const InfoPanel: React.FC = () => {
  const selectedItems = useSelectionStore((s) => s.selectedItems);
  const isInfoPanelOpen = useUIStore((s) => s.isInfoPanelOpen);
  const toggleInfoPanel = useUIStore((s) => s.toggleInfoPanel);

  // Hooks must be called unconditionally (moved here from after early returns —
  // the original code had a hooks violation where useState/useToastStore were
  // only called when selectedItems.length === 1).
  const [isSyncing, setIsSyncing] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const { drives } = useDriveStore();

  const singleSelection = selectedItems.length === 1 ? selectedItems[0] : null;
  const { type, item } = singleSelection ?? { type: 'file' as const, item: null };

  const handleForceSync = async () => {
    if (!singleSelection || singleSelection.type !== 'folder') return;
    setIsSyncing(true);
    try {
      const { api } = await import('../../lib/api');
      const driveId = (singleSelection.item as any).driveAccountId || '';
      await api.forceSyncFolder(singleSelection.item.id!, driveId);
      addToast('success', 'Sync queued. Data will update shortly.');
    } catch (err: any) {
      addToast('error', err.message || 'Failed to queue sync.');
    } finally {
      setIsSyncing(false);
    }
  };

  const renderContent = () => {
    if (selectedItems.length === 0) {
      return (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-stone-800">Details</h2>
            <button onClick={toggleInfoPanel} className="p-1.5 hover:bg-stone-100 rounded-full text-stone-500">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <File size={48} className="text-stone-300 mb-4" />
            <p className="text-sm text-stone-500">Select a file or folder to see its details here.</p>
          </div>
        </>
      );
    }

    if (selectedItems.length > 1) {
      return (
        <>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-stone-800">Details</h2>
            <button onClick={toggleInfoPanel} className="p-1.5 hover:bg-stone-100 rounded-full text-stone-500">
              <X size={18} />
            </button>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <File size={48} className="text-stone-300 mb-4" />
            <p className="text-sm text-stone-800 font-medium">{selectedItems.length} items selected</p>
            <p className="text-xs text-stone-500 mt-2">Select a single item to view its properties.</p>
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
          <h2 className="text-lg font-semibold text-stone-800">Details</h2>
          <button onClick={toggleInfoPanel} className="p-1.5 hover:bg-stone-100 rounded-full text-stone-500 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="mb-6 flex justify-center">
          {type === 'folder' ? (
            <div className="w-24 h-24 bg-blue-50 rounded-2xl flex items-center justify-center">
              <Folder size={48} className="text-blue-500" fill="currentColor" />
            </div>
          ) : (
            <div className="w-24 h-24 bg-stone-50 border border-stone-200 rounded-2xl flex items-center justify-center text-5xl shadow-sm">
              <FileIcon mimeType={item?.mimeType} />
            </div>
          )}
        </div>

        <h3 className="text-base font-medium text-stone-800 text-center mb-6 break-words px-2">
          {item?.name}
        </h3>

        <div className="space-y-4">
          <div className="border-t border-stone-100 pt-4">
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Properties</h4>
            <dl className="space-y-3 text-sm">
              {driveAccount && (
                <div className="flex flex-col">
                  <dt className="text-stone-500 mb-1 text-xs">Stored on</dt>
                  <dd>
                    <DriveBadge email={driveAccount.email} colorIndex={driveIndex} size="md" />
                  </dd>
                </div>
              )}
              <div className="flex flex-col">
                <dt className="text-stone-500 mb-0.5 text-xs">Type</dt>
                <dd className="text-stone-800">{type === 'folder' ? 'Google Drive Folder' : item?.mimeType || 'Unknown file type'}</dd>
              </div>
              {type === 'file' && (
                <div className="flex flex-col">
                  <dt className="text-stone-500 mb-0.5 text-xs">Size</dt>
                  <dd className="text-stone-800">{formatFileSize(item?.size ?? 0)}</dd>
                </div>
              )}
              <div className="flex flex-col">
                <dt className="text-stone-500 mb-0.5 text-xs">Modified</dt>
                <dd className="text-stone-800">
                  {type === 'file'
                    ? formatRelativeTime(item?.googleModifiedAt ?? item?.createdAt ?? '')
                    : '—'}
                </dd>
              </div>
              {type === 'file' && item?.googleCreatedAt && (
                <div className="flex flex-col">
                  <dt className="text-stone-500 mb-0.5 text-xs">Created</dt>
                  <dd className="text-stone-800">{formatRelativeTime(item?.googleCreatedAt ?? '')}</dd>
                </div>
              )}
              {type === 'folder' && item && 'lastSyncedAt' in item && (
                <div className="flex flex-col">
                  <dt className="text-stone-500 mb-0.5 text-xs">Last Synced</dt>
                  <dd className="text-stone-800">
                    {(item as any).lastSyncedAt ? formatRelativeTime((item as any).lastSyncedAt) : 'Never'}
                  </dd>
                </div>
              )}
            </dl>

            {type === 'folder' && (
              <div className="mt-4">
                <button
                  onClick={handleForceSync}
                  disabled={isSyncing}
                  className="flex items-center justify-center w-full gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {isSyncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                  {isSyncing ? 'Syncing...' : 'Force Sync'}
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-stone-100 pt-4">
            <h4 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-3">Tags & Metadata</h4>
            {item && ('metadata' in item && item.metadata) ? (
              <div className="flex flex-wrap gap-2 mb-3">
                {Object.entries(typeof (item as any).metadata === 'string' ? JSON.parse((item as any).metadata) : (item as any).metadata).map(([k, v]) => (
                  <div key={k} className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center">
                    <span className="font-semibold mr-1">{k}:</span> {v as string}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-stone-400 mb-3">No tags applied.</p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const key = (form.elements.namedItem('metaKey') as HTMLInputElement).value;
                const value = (form.elements.namedItem('metaValue') as HTMLInputElement).value;
                if (!key || !value || !item) return;

                const { api } = await import('../../lib/api');
                const currentMeta = typeof (item as any).metadata === 'string' ? JSON.parse((item as any).metadata || '{}') : ((item as any).metadata || {});
                const newMeta = { ...currentMeta, [key]: value };

                try {
                  if (type === 'file') {
                    await api.updateFileMetadata(item.id!, newMeta);
                  } else if ((item as any).workspaceId) {
                    await api.updateFolderMetadata((item as any).workspaceId, item.id!, newMeta);
                  }
                  (item as any).metadata = newMeta;
                  form.reset();
                } catch (err) {
                  console.error(err);
                }
              }}
              className="flex gap-2"
            >
              <input name="metaKey" placeholder="Key" className="w-1/3 border rounded px-2 py-1 text-xs" />
              <input name="metaValue" placeholder="Value" className="flex-1 border rounded px-2 py-1 text-xs" />
              <button type="submit" className="bg-stone-800 text-white px-2 py-1 rounded text-xs">Add</button>
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
        className={`bg-card border-l border-stone-200 h-full flex-shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out z-50 ${
          // Mobile: fixed drawer from right; Desktop: inline collapsible panel
          isInfoPanelOpen ? 'fixed right-0 top-16 bottom-0 w-[88%] max-w-sm shadow-xl md:relative md:top-0 md:shadow-none md:w-80 md:max-w-none' : 'w-0 md:w-0'
        }`}
        aria-hidden={!isInfoPanelOpen}
      >
      {/* Fixed-width inner wrapper so content stays put while the aside width animates */}
      <div
        className={`w-[88%] max-w-sm md:w-80 h-full flex flex-col p-4 transition-opacity duration-200 ${
          isInfoPanelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {renderContent()}
      </div>
    </aside>
    </>
  );
};
