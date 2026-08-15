import { useState, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDrives, useRemoveDrive, useTriggerSync, useForceResync } from '../../hooks/useDrives';
import { qk } from '../../lib/queryKeys';
import { DriveAccountCard } from '../DriveAccountCard';
import { useToastStore } from '../../stores/useToastStore';
import { Plus, Key, X } from 'lucide-react';
import { drivesApi } from '../../lib/api/drives';
import { authApi } from '../../lib/api/auth';
import { Button } from '../ui/Button';

export function SettingsDrivesTab() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const removeDriveMutation = useRemoveDrive();
  const triggerSyncMutation = useTriggerSync();
  const forceResyncMutation = useForceResync();
  const queryClient = useQueryClient();
  const { addToast } = useToastStore();
  const [showSaForm, setShowSaForm] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saCredentials, setSaCredentials] = useState('');
  const [saFolderId, setSaFolderId] = useState('');

  // ADR-0004: pessimistic mutations — drive.syncStatus (from D1 via the API)
  // is the single source of truth for the sync button state. No local
  // syncingDriveId/recentlySynced override state (the previous optimistic UI
  // got stuck when the component unmounted mid-sync).

  // Poll while any drive is actively syncing OR has a paused initial sync.
  // syncPaused = next_page_token IS NOT NULL (initial sync in progress).
  // !lastSyncedAt = initial sync hasn't completed yet.
  useEffect(() => {
    const hasActiveSync = drives.some(
      (d) => d.syncStatus === 'syncing' || (d.syncPaused && !d.lastSyncedAt),
    );
    if (!hasActiveSync) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: qk.drives });
    }, 5000);

    return () => clearInterval(interval);
  }, [drives, queryClient]);

  // Transition tracker: detect syncing → idle/error transitions to show
  // completion/failure toasts. Closes the feedback loop — the user no longer
  // has to notice the "Last synced" timestamp change.
  const prevSyncStatus = useRef<Record<string, string>>({});
  useEffect(() => {
    for (const drive of drives) {
      const prev = prevSyncStatus.current[drive.id];
      const current = drive.syncStatus ?? 'idle';
      if (prev === 'syncing' && current === 'idle') {
        addToast('success', `Sync complete: ${drive.email}`);
      } else if (prev === 'syncing' && current === 'error') {
        addToast('error', `Sync failed: ${drive.email}`);
      }
      prevSyncStatus.current[drive.id] = current;
    }
  }, [drives, addToast]);

  const handleConnectDrive = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { url } = await authApi.getDriveConnectUrl();
      window.location.href = url;
    } catch (e) {
      setIsConnecting(false);
      addToast('error', e instanceof Error ? e.message : 'Failed to start Google OAuth');
    }
  };

  const handleSync = async (id: string) => {
    try {
      await triggerSyncMutation.mutateAsync(id);
      addToast('success', 'Sync started.');
      // POST returned 204 (sync enqueued via queue). Refetch to pick up
      // syncStatus='syncing' — and again after 1s to catch the race where
      // the queue consumer hasn't picked up the message yet.
      queryClient.invalidateQueries({ queryKey: qk.drives });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: qk.drives }), 1000);
    } catch {
      addToast('error', 'Failed to start sync');
    }
  };

  const handleForceResync = async (id: string) => {
    addToast(
      'info',
      'Force re-syncing... this will re-fetch ALL files and may take 5-15 minutes for large drives',
    );
    try {
      await forceResyncMutation.mutateAsync(id);
      // Pessimistic: POST returned 204 (sync enqueued via queue). Refetch to
      // pick up syncStatus='syncing' — and again after 1s to catch the race
      // where the queue consumer hasn't picked up the message yet.
      queryClient.invalidateQueries({ queryKey: qk.drives });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: qk.drives }), 1000);
    } catch {
      addToast('error', 'Failed to start force re-sync');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await removeDriveMutation.mutateAsync(id);
    } catch {
      // error toast handled by mutation's onError
    }
  };

  // Reconnect triggers the existing OAuth flow. The callback re-links the
  // existing drive (by google_account_id) via drive_tokens UPSERT — no data
  // loss, no full re-sync. Only the dead refresh token is replaced.
  const handleReconnect = async () => {
    try {
      const { url } = await authApi.getDriveConnectUrl();
      window.location.href = url;
    } catch {
      addToast('error', 'Failed to start reconnection');
    }
  };

  const handleAddServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await drivesApi.addServiceAccount(saCredentials, saFolderId);
      addToast('success', 'Service account added');
      setSaCredentials('');
      setSaFolderId('');
      setShowSaForm(false);
      queryClient.invalidateQueries({ queryKey: qk.drives });
    } catch {
      addToast('error', 'Failed to add service account');
    }
  };

  return (
    <>
      {/* Section: Connected Drives */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Connected Drives
        </h2>
        <div className="space-y-3">
          {drives.map((drive, i) => (
            <DriveAccountCard
              key={drive.id}
              drive={drive}
              index={i}
              onSync={handleSync}
              onForceResync={handleForceResync}
              onDisconnect={handleDisconnect}
              onReconnect={handleReconnect}
            />
          ))}
          {drives.length === 0 && (
            <div className="text-center py-8 text-slate-500 border border-dashed border-slate-200 rounded-xl">
              No drives connected yet
            </div>
          )}
        </div>
      </div>

      {/* Section: Add Drive */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Add Drive
        </h2>
        <div className="flex gap-2 sm:gap-3 flex-col sm:flex-row">
          <Button
            onClick={handleConnectDrive}
            disabled={isConnecting}
            variant="primary"
            size="md"
            className="justify-center py-2.5 rounded-xl disabled:opacity-60"
            loading={isConnecting}
          >
            {!isConnecting && <Plus size={18} />} Add Google Drive
          </Button>
          <Button
            variant="secondary"
            size="md"
            className="justify-center py-2.5 rounded-xl hover:bg-slate-50"
            onClick={() => setShowSaForm(!showSaForm)}
          >
            <Key size={18} /> Add Service Account
          </Button>
        </div>
      </div>

      {/* Service Account Form */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showSaForm ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="bg-card border border-slate-200 rounded-2xl p-4 sm:p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">Add Service Account</h3>
              <Button
                onClick={() => setShowSaForm(false)}
                variant="ghost"
                className="p-1.5 rounded-full text-slate-500"
                aria-label="Close form"
              >
                <X size={18} />
              </Button>
            </div>
            <form onSubmit={handleAddServiceAccount} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Service Account JSON
                </label>
                <textarea
                  value={saCredentials}
                  onChange={(e) => setSaCredentials(e.target.value)}
                  placeholder="Paste service account JSON key..."
                  rows={6}
                  className="w-full font-mono text-xs border border-slate-400 rounded-xl p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary resize-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Shared Folder ID
                </label>
                <input
                  type="text"
                  value={saFolderId}
                  onChange={(e) => setSaFolderId(e.target.value)}
                  placeholder="Google Drive folder ID shared with SA"
                  className="w-full border border-slate-400 rounded-xl p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  required
                />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-xl hover:bg-slate-50"
                  onClick={() => setShowSaForm(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="rounded-xl">
                  Add Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
