import { HardDrive, RefreshCw, Trash2 } from 'lucide-react';
import type { DriveAccount } from '../types';
import { QuotaBar } from './QuotaBar';
import { formatAbsoluteDate, formatFileSize, getDriveColor } from '../lib/utils';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import { Button } from './ui/Button';

interface DriveAccountCardProps {
  drive: DriveAccount;
  index: number;
  onSync: (id: string) => Promise<void>;
  onDisconnect: (id: string) => Promise<void>;
  onReconnect?: () => void;
  isSyncingOverride?: boolean;
}

export function DriveAccountCard({ drive, index, onSync, onDisconnect, onReconnect, isSyncingOverride }: DriveAccountCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const color = getDriveColor(index);

  // Parent owns the syncing state (persists for the full sync duration).
  // drive.syncStatus covers syncs started by the cron or reconnect flow.
  const isSyncing = isSyncingOverride || drive.syncStatus === 'syncing';
  // Token-refresh failure is permanent — Google revoked the refresh token.
  // Sync will always fail until the user reconnects (new OAuth flow).
  const needsReconnect =
    drive.syncStatus === 'error' &&
    !!drive.syncErrorMessage?.includes('Token refresh') &&
    !!onReconnect;

  const handleSync = async () => {
    await onSync(drive.id);
  };

  const handleDisconnect = () => {
    setConfirmOpen(true);
  };

  const confirmDisconnect = async () => {
    setIsDisconnecting(true);
    try { await onDisconnect(drive.id); } finally {
      setIsDisconnecting(false);
      setConfirmOpen(false);
    }
  };

  const disconnectMessage =
    `Disconnect ${drive.email}?` +
    (drive.isPrimary
      ? ' This is your primary drive — another connected drive will become primary if available.'
      : '') +
    ' Your files on Google Drive will not be deleted; only OmniDrive access and synced data will be removed.';

  return (
    <div className="bg-card border border-slate-200 rounded-2xl p-4 sm:p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: color }}
          >
            <HardDrive size={16} color="white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{drive.email}</div>
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
              {needsReconnect && (
                <span className="ml-1.5 text-amber-600 font-medium">· reconnect needed</span>
              )}
              {drive.syncStatus === 'syncing' && (
                <span className="ml-1.5 text-blue-500 font-medium">· syncing</span>
              )}
            </div>
            {drive.lastSyncedAt && (
              <div className="text-[10px] text-slate-500 mt-0.5">
                Last synced: {formatAbsoluteDate(drive.lastSyncedAt)}
              </div>
            )}
          </div>
        </div>
        {/* Buttons inline on the right — desktop shows full labels, mobile shows icons only */}
        <div className="flex gap-2 flex-shrink-0">
          {needsReconnect ? (
            <Button
              variant="primary"
              className="gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg"
              onClick={onReconnect}
              title="Get a new Google connection without losing your synced files"
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">Reconnect</span>
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs bg-slate-50 border-slate-200 rounded-lg disabled:opacity-50"
              onClick={handleSync}
              disabled={isSyncing}
            >
              <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
            </Button>
          )}
          <Button
            variant="ghost"
            className="gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            onClick={handleDisconnect}
          >
            <Trash2 size={12} />
            <span className="hidden sm:inline">Disconnect</span>
          </Button>
        </div>
      </div>

      {drive.hasLimit !== false ? (
        <>
          <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={color} showLabel={false} />
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span className="truncate">{formatFileSize(drive.freeSpace)} free of {formatFileSize(drive.totalQuota)}</span>
            <span className="flex-shrink-0 ml-2">{Math.min(drive.usagePercent, 100).toFixed(1)}%</span>
          </div>
        </>
      ) : (
        /* Google Workspace pooled storage — limit not reported by the API.
           Show used only; a subtle indicator bar replaces the fake 1 TiB total. */
        <div className="mt-2">
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: '100%', backgroundColor: color, opacity: 0.3 }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span className="truncate">{formatFileSize(drive.usedQuota)} used</span>
            <span className="flex-shrink-0 ml-2 text-slate-400">Pooled storage</span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Disconnect Drive"
        message={disconnectMessage}
        confirmText="Disconnect"
        cancelText="Cancel"
        variant="danger"
        loading={isDisconnecting}
        onConfirm={confirmDisconnect}
        onClose={() => !isDisconnecting && setConfirmOpen(false)}
      />
    </div>
  );
}
