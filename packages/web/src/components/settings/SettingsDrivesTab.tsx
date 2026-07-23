import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDrives, useRemoveDrive, useTriggerSync } from '../../hooks/useDrives';
import { qk } from '../../lib/queryKeys';
import { DriveAccountCard } from '../DriveAccountCard';
import { useToastStore } from '../../stores/useToastStore';
import { Plus, Key, X, LoaderCircle } from 'lucide-react';
import { api } from '../../lib/api';

export function SettingsDrivesTab() {
  const { data: drivesData } = useDrives();
  const drives = useMemo(() => drivesData?.drives ?? [], [drivesData]);
  const removeDriveMutation = useRemoveDrive();
  const triggerSyncMutation = useTriggerSync();
  const queryClient = useQueryClient();
  const { addToast } = useToastStore();
  const [showSaForm, setShowSaForm] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [saCredentials, setSaCredentials] = useState('');
  const [saFolderId, setSaFolderId] = useState('');

  // Poll drive sync status while any drive is syncing
  useEffect(() => {
    const hasSyncing = drives.some(d => d.syncStatus === 'syncing');
    if (!hasSyncing) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: qk.drives });
    }, 3000);

    return () => clearInterval(interval);
  }, [drives, queryClient]);

  const handleConnectDrive = async () => {
    if (isConnecting) return;
    setIsConnecting(true);
    try {
      const { url } = await api.getDriveConnectUrl();
      window.location.href = url;
    } catch (e) {
      setIsConnecting(false);
      addToast('error', e instanceof Error ? e.message : 'Failed to start Google OAuth');
    }
  };

  const handleSync = async (id: string) => {
    try {
      addToast('info', 'Syncing... large drives may take multiple cycles');
      let cycles = 0;
      const maxCycles = 50;

      const runSyncCycle = async (): Promise<void> => {
        await triggerSyncMutation.mutateAsync(id);
        cycles++;
        await new Promise((r) => setTimeout(r, 3000));
        await queryClient.invalidateQueries({ queryKey: qk.drives });
        const drivesData = queryClient.getQueryData<{ drives: typeof drives }>(qk.drives);
        const drive = drivesData?.drives.find((d) => d.id === id);

        if (drive?.syncPaused && cycles < maxCycles) {
          return runSyncCycle();
        }
      };

      await runSyncCycle();
      addToast('success', `Sync completed (${cycles} cycle${cycles > 1 ? 's' : ''})`);
    } catch {
      addToast('error', 'Sync failed');
    }
  };

  const handleDisconnect = async (id: string) => {
    try {
      await removeDriveMutation.mutateAsync(id);
    } catch {
      // error toast handled by mutation's onError
    }
  };

  const handleAddServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addServiceAccount(saCredentials, saFolderId);
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
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Connected Drives</h2>
        <div className="space-y-3">
          {drives.map((drive, i) => (
            <DriveAccountCard
              key={drive.id}
              drive={drive}
              index={i}
              onSync={handleSync}
              onDisconnect={handleDisconnect}
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
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Add Drive</h2>
        <div className="flex gap-2 sm:gap-3 flex-col sm:flex-row">
          <button
            onClick={handleConnectDrive}
            disabled={isConnecting}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-60"
          >
            {isConnecting ? <LoaderCircle size={18} className="animate-spin" /> : <Plus size={18} />} Add Google Drive
          </button>
          <button
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-card text-slate-700 rounded-xl border border-slate-400 hover:bg-slate-50 transition-colors font-medium text-sm"
            onClick={() => setShowSaForm(!showSaForm)}
          >
            <Key size={18} /> Add Service Account
          </button>
        </div>
      </div>

      {/* Service Account Form */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${showSaForm ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="bg-card border border-slate-200 rounded-2xl p-4 sm:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-slate-800">Add Service Account</h3>
            <button
              onClick={() => setShowSaForm(false)}
              className="p-1.5 hover:bg-slate-100 rounded-full text-slate-500 transition-colors"
            >
              <X size={18} />
            </button>
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
                className="w-full font-mono text-xs border border-slate-400 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
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
                className="w-full border border-slate-400 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-card border border-slate-400 rounded-xl hover:bg-slate-50 transition-colors"
                onClick={() => setShowSaForm(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors"
              >
                Add Account
              </button>
            </div>
          </form>
          </div>
        </div>
      </div>
    </>
  );
}
