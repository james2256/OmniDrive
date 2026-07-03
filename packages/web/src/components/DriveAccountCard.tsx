import { HardDrive, RefreshCw, Trash2, Settings2 } from 'lucide-react';
import type { DriveAccount } from '../types';
import { QuotaBar } from './QuotaBar';
import { formatFileSize, getDriveColor, parseSizeToBytes } from '../lib/utils';
import { useState } from 'react';
import { api } from '../lib/api';
import { useToastStore } from '../stores/toastStore';

interface DriveAccountCardProps {
  drive: DriveAccount;
  index: number;
  onSync: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  onQuotaSaved?: () => void | Promise<void>;
}

export function DriveAccountCard({ drive, index, onSync, onDisconnect, onQuotaSaved }: DriveAccountCardProps) {
  const [syncing, setSyncing] = useState(false);
  const [editingQuota, setEditingQuota] = useState(false);
  const [quotaInput, setQuotaInput] = useState('');
  const [quotaSaving, setQuotaSaving] = useState(false);
  const { addToast } = useToastStore();
  const color = getDriveColor(index);
  
  const isSyncing = syncing || drive.syncStatus === 'syncing';

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(drive.id); } finally { setSyncing(false); }
  };

  const startEditQuota = () => {
    const o = drive.quotaOverride;
    // Show override if set, else current computed total so the user sees what's in use.
    setQuotaInput(formatFileSize(o && o > 0 ? o : drive.totalQuota));
    setEditingQuota(true);
  };

  const saveQuota = async () => {
    const bytes = parseSizeToBytes(quotaInput);
    if (bytes === null) {
      addToast('error', 'Invalid size. Use format like 5 TB, 500 GB');
      return;
    }
    setQuotaSaving(true);
    try {
      await api.updateDriveQuota(drive.id, bytes === 0 ? null : bytes);
      addToast('success', 'Storage capacity updated');
      setEditingQuota(false);
      await onQuotaSaved?.();
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'Failed to update capacity');
    } finally {
      setQuotaSaving(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            <HardDrive size={18} color="white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{drive.email}</div>
            <div className="text-xs text-gray-400">
              {drive.type === 'service_account' ? 'Service Account' : 'OAuth'}
              {drive.isPrimary && <span className="ml-1.5 text-blue-500 font-medium">· Primary</span>}
              {drive.quotaOverride && drive.quotaOverride > 0 && (
                <span className="ml-1.5 text-amber-600" title="Capacity set manually — Google's API does not report it for this account">· manual</span>
              )}
              {drive.health === 'auth_expired' && (
                <span className="ml-1.5 text-red-600 font-medium" title="Google session expired — disconnect and reconnect this account">· reconnect needed</span>
              )}
              {drive.health === 'error' && (
                <span className="ml-1.5 text-amber-600" title="Could not reach Google Drive on last check — usually temporary">· unreachable</span>
              )}
            </div>
            {drive.lastSyncedAt && (
              <div className="text-[10px] text-gray-400 mt-0.5">
                Last synced: {new Date(drive.lastSyncedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center px-2 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            onClick={startEditQuota}
            title="Set storage capacity manually (for Workspace / service accounts where Google omits the limit)"
          >
            <Settings2 size={12} />
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
            onClick={handleSync}
            disabled={isSyncing}
          >
            <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
            onClick={() => {
              const primaryNote = drive.isPrimary
                ? ' This is your primary drive — another connected drive will become primary if available.'
                : '';
              const message =
                `Disconnect ${drive.email}?${primaryNote} ` +
                'Your files on Google Drive will not be deleted; only AzaDrive access and synced data will be removed.';
              if (confirm(message)) {
                void onDisconnect(drive.id);
              }
            }}
          >
            <Trash2 size={12} />
            Disconnect
          </button>
        </div>
      </div>

      {editingQuota ? (
        <div className="space-y-2">
          <input
            autoFocus
            className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="e.g. 5 TB, 500 GB"
            value={quotaInput}
            onChange={(e) => setQuotaInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveQuota();
              if (e.key === 'Escape') setEditingQuota(false);
            }}
          />
          <p className="text-[10px] text-gray-400">
            Google's API hides the real limit for Workspace / service accounts. Enter the actual capacity (e.g. 5 TB). Set 0 to clear.
          </p>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 text-xs text-white bg-primary rounded hover:bg-primary/90 disabled:opacity-50"
              onClick={saveQuota}
              disabled={quotaSaving}
            >
              {quotaSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
              onClick={() => setEditingQuota(false)}
              disabled={quotaSaving}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={color} showLabel={false} />
          <div className="flex justify-between mt-2 text-xs text-gray-400">
            <span>{formatFileSize(drive.freeSpace)} free of {formatFileSize(drive.totalQuota)}</span>
            <span>{drive.usagePercent}%</span>
          </div>
        </>
      )}
    </div>
  );
}
