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

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(drive.id); } finally { setSyncing(false); }
  };

  return (
    <div className="card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: getDriveColor(index), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <HardDrive size={20} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{drive.email}</div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
              {drive.type === 'service_account' ? 'Service Account' : 'OAuth'}{drive.isPrimary ? ' · Primary' : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? 'spinning' : ''} /> Sync
          </button>
          {!drive.isPrimary && (
            <button className="btn btn-danger btn-sm" onClick={() => {
              if (confirm(`Disconnect ${drive.email}? Files from this drive will be removed from Omnidrive.`)) {
                onDisconnect(drive.id);
              }
            }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={getDriveColor(index)} />

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-sm)', fontSize: 'var(--font-size-xs)', color: 'var(--text-tertiary)' }}>
        <span>{formatFileSize(drive.freeSpace)} free of {formatFileSize(drive.totalQuota)}</span>
        <span>{drive.usagePercent}% used</span>
      </div>

      <style>{`
        .spinning { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
