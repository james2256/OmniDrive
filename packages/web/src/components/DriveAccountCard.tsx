import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import type { DriveAccount } from '../types';
import { QuotaBar } from './QuotaBar';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { useState } from 'react';

interface DriveAccountCardProps {
  drive: DriveAccount;
  index: number;
  onSync: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
}

export function DriveAccountCard({ drive, index, onSync, onDisconnect }: DriveAccountCardProps) {
  const [syncing, setSyncing] = useState(false);
  const color = getDriveColor(index);

  const isSyncing = syncing || drive.syncStatus === 'syncing';

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(drive.id); } finally { setSyncing(false); }
  };

  return (
    <div className="bg-card border border-slate-200 rounded-2xl p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            <HardDrive size={18} color="white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-800">{drive.email}</div>
            <div className="text-xs text-slate-500">
              {drive.type === 'service_account' ? 'Service Account' : 'OAuth'}
              {drive.isPrimary && <span className="ml-1.5 text-blue-500 font-medium">· Primary</span>}
              {drive.health === 'auth_expired' && (
                <span className="ml-1.5 text-red-600 font-medium" title="Google session expired — disconnect and reconnect this account">· reconnect needed</span>
              )}
              {drive.health === 'error' && (
                <span className="ml-1.5 text-amber-600" title="Could not reach Google Drive on last check — usually temporary">· unreachable</span>
              )}
              {drive.syncStatus === 'error' && (
                <span
                  className="ml-1.5 text-red-600 font-medium"
                  title={`Sync failed: ${drive.syncErrorMessage || 'unknown error'}`}
                >
                  · sync failed
                </span>
              )}
              {drive.syncStatus === 'syncing' && (
                <span className="ml-1.5 text-blue-500 font-medium">· syncing</span>
              )}
            </div>
            {drive.lastSyncedAt && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                Last synced: {new Date(drive.lastSyncedAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
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
                'Your files on Google Drive will not be deleted; only OmniDrive access and synced data will be removed.';
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

      <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={color} showLabel={false} />
      <div className="flex justify-between mt-2 text-xs text-slate-500">
        <span>{formatFileSize(drive.freeSpace)} free of {formatFileSize(drive.totalQuota)}</span>
        <span>{Math.min(drive.usagePercent, 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
