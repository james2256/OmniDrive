import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useDriveStore } from '../stores/driveStore';
import { useAuthStore } from '../stores/authStore';
import { useSharedStore } from '../stores/sharedStore';
import { QuotaBar } from '../components/QuotaBar';
import { FileGrid } from '../components/files/FileGrid';
import { ShareModal } from '../components/ShareModal';
import { MoveDriveModal } from '../components/MoveDriveModal';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { formatFileSize, getDriveColor } from '../lib/utils';
import { api } from '../lib/api';
import { useToastStore } from '../stores/toastStore';
import type { FileEntry, WorkspaceFolder } from '../types';
import {
  HardDrive,
  RefreshCw,
  Clock,
  Star,
  FolderTree,
  Share2,
  Settings,
  ArrowRight,
  Plus,
  Cloud,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  Archive,
  Users,
} from 'lucide-react';

type CategoryOverview = {
  images: number;
  videos: number;
  documents: number;
  audio: number;
  archives: number;
  others: number;
};

const CATEGORY_META: {
  key: keyof CategoryOverview;
  label: string;
  color: string;
  Icon: typeof ImageIcon;
}[] = [
  { key: 'documents', label: 'Documents', color: '#3b82f6', Icon: FileText },
  { key: 'images', label: 'Images', color: '#ef4444', Icon: ImageIcon },
  { key: 'videos', label: 'Videos', color: '#f59e0b', Icon: Film },
  { key: 'audio', label: 'Audio', color: '#10b981', Icon: Music },
  { key: 'archives', label: 'Archives', color: '#6366f1', Icon: Archive },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 11) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function firstName(name?: string | null): string {
  if (!name) return '';
  return name.split(' ')[0];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { drives, aggregate, isLoading, fetchDrives } = useDriveStore();
  const { user } = useAuthStore();
  const { sharedLinks, fetchSharedLinks, isTargetShared } = useSharedStore();
  const { addToast } = useToastStore();

  const [recentFiles, setRecentFiles] = useState<FileEntry[]>([]);
  const [recentFolders, setRecentFolders] = useState<WorkspaceFolder[]>([]);
  const [category, setCategory] = useState<CategoryOverview | null>(null);

  const [shareTarget, setShareTarget] = useState<{ id: string; type: 'file' | 'folder' } | null>(null);
  const [moveDriveFiles, setMoveDriveFiles] = useState<FileEntry[]>([]);
  const [previewFile, setPreviewFile] = useState<FileEntry | null>(null);

  const refreshRecent = useCallback(() => {
    api.getRecentFiles().then((data) => {
      setRecentFiles(data.files.slice(0, 8));
      setRecentFolders(data.folders ? data.folders.slice(0, 8) : []);
    }).catch(() => {});
  }, []);

  const refreshCategory = useCallback(() => {
    api.getFileCategoryOverview().then(setCategory).catch(() => setCategory(null));
  }, []);

  useEffect(() => {
    fetchDrives();
    fetchSharedLinks();
    refreshRecent();
    refreshCategory();
  }, [fetchDrives, fetchSharedLinks, refreshRecent, refreshCategory]);

  const hasDrives = drives.length > 0;
  const hasRecent = recentFiles.length > 0 || recentFolders.length > 0;
  const usedPercent = aggregate.totalQuota > 0
    ? (aggregate.totalUsed / aggregate.totalQuota) * 100
    : 0;

  // Donut data — only categories with bytes, sorted desc. Others folded in.
  const donutData = useMemo(() => {
    if (!category) return [];
    const rows = CATEGORY_META
      .map((m) => ({ name: m.label, value: category[m.key], color: m.color }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value);
    if ((category.others ?? 0) > 0) {
      rows.push({ name: 'Other', value: category.others, color: '#9ca3af' });
    }
    return rows;
  }, [category]);

  const totalCategoryBytes = donutData.reduce((sum, d) => sum + d.value, 0);

  const starredCount = recentFiles.filter((f) => f.isStarred).length;

  const quickLinks = [
    { to: '/files/root', label: 'My Drive', Icon: HardDrive, hint: 'Browse all files' },
    { to: '/starred', label: 'Starred', Icon: Star, hint: `${starredCount} marked` },
    { to: '/shared', label: 'Shared', Icon: Share2, hint: `${sharedLinks.length} links` },
    { to: '/workspaces', label: 'Workspaces', Icon: FolderTree, hint: 'Team folders' },
  ] as const;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Greeting + refresh */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-800">
            {greeting()}{user ? `, ${firstName(user.name)}` : ''}
          </h1>
          <p className="text-sm text-stone-500 mt-0.5">
            {hasDrives
              ? `${aggregate.driveCount} drive${aggregate.driveCount > 1 ? 's' : ''} connected · ${formatFileSize(aggregate.totalFree)} free`
              : 'Connect a Google Drive to get started'}
          </p>
        </div>
        <button
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-600 bg-card border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
          onClick={() => {
            fetchDrives();
            refreshRecent();
            refreshCategory();
            addToast('info', 'Refreshed');
          }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Empty state — no drives yet. */}
      {!hasDrives && !isLoading && (
        <div className="bg-card border border-stone-200 rounded-2xl p-8 sm:p-12 text-center bento-reveal">
          <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <Cloud size={26} className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-stone-800">No drives connected</h2>
          <p className="text-sm text-stone-500 mt-1 max-w-md mx-auto">
            Connect your first Google Drive to start syncing, browsing, and sharing files from one place.
          </p>
          <button
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:opacity-90 transition-opacity"
            onClick={() => navigate('/settings/drives')}
          >
            <Plus size={16} />
            Connect a drive
          </button>
        </div>
      )}

      {/* Loading skeleton — matches bento shape */}
      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 auto-rows-[minmax(140px,auto)]">
          <div className="lg:col-span-2 lg:row-span-2 bg-card border border-stone-200 rounded-2xl animate-pulse" />
          <div className="lg:col-span-2 bg-card border border-stone-200 rounded-2xl animate-pulse" />
          <div className="lg:col-span-2 bg-card border border-stone-200 rounded-2xl animate-pulse" />
        </div>
      )}

      {/* Bento grid — 4 cols desktop. Cell count = content count, no empty cells. */}
      {hasDrives && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 auto-rows-[minmax(150px,auto)]">
          {/* Storage hero — col-span-2 row-span-2 */}
          <article
            className="lg:col-span-2 lg:row-span-2 bg-card border border-stone-200 rounded-2xl p-6 flex flex-col justify-between bento-reveal"
            style={{ animationDelay: '60ms' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-stone-500">Total storage</span>
              <span className="text-xs text-stone-400">{aggregate.driveCount} drives</span>
            </div>
            <div className="my-4">
              <div className="text-5xl sm:text-6xl font-semibold text-stone-800 tracking-tight leading-none">
                {usedPercent.toFixed(1)}<span className="text-2xl text-stone-400 ml-1">%</span>
              </div>
              <p className="text-sm text-stone-500 mt-2">
                {formatFileSize(aggregate.totalUsed)} of {formatFileSize(aggregate.totalQuota)} used
              </p>
            </div>
            <div>
              <QuotaBar used={aggregate.totalUsed} total={aggregate.totalQuota} showLabel={false} />
              <div className="flex gap-4 mt-3 text-sm">
                <span className="text-primary font-medium">{formatFileSize(aggregate.totalFree)} free</span>
                <span className="text-stone-300">·</span>
                <span className="text-stone-500">{formatFileSize(aggregate.totalUsed)} used</span>
              </div>
            </div>
          </article>

          {/* Category donut — col-span-2. Real visual (Recharts). */}
          <article
            className="lg:col-span-2 bg-card border border-stone-200 rounded-2xl p-5 flex flex-col bento-reveal"
            style={{ animationDelay: '120ms' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-stone-500">By type</span>
              {totalCategoryBytes > 0 && (
                <span className="text-xs text-stone-400">{formatFileSize(totalCategoryBytes)}</span>
              )}
            </div>

            {donutData.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-stone-400">No files synced yet.</p>
              </div>
            ) : (
              <div className="flex items-center gap-4 flex-1">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="62%"
                        outerRadius="100%"
                        paddingAngle={2}
                        strokeWidth={0}
                        isAnimationActive
                        animationDuration={700}
                      >
                        {donutData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xs text-stone-400 leading-none">used</span>
                    <span className="text-sm font-semibold text-stone-700 leading-tight mt-0.5">
                      {formatFileSize(aggregate.totalUsed)}
                    </span>
                  </div>
                </div>
                <ul className="flex-1 space-y-1.5 min-w-0">
                  {donutData.slice(0, 4).map((c) => {
                    const pct = totalCategoryBytes > 0 ? (c.value / totalCategoryBytes) * 100 : 0;
                    return (
                      <li key={c.name} className="flex items-center justify-between text-sm gap-2">
                        <span className="flex items-center gap-2 text-stone-600 min-w-0">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                          <span className="truncate">{c.name}</span>
                        </span>
                        <span className="text-stone-400 text-xs flex-shrink-0">
                          {pct.toFixed(0)}%
                        </span>
                      </li>
                    );
                  })}
                  {donutData.length > 4 && (
                    <li className="text-xs text-stone-400 pt-1">+{donutData.length - 4} more</li>
                  )}
                </ul>
              </div>
            )}
          </article>

          {/* Quick links — col-span-2, tinted bg-surface for background diversity. */}
          <article
            className="lg:col-span-2 bg-surface border border-stone-200/70 rounded-2xl p-5 bento-reveal"
            style={{ animationDelay: '180ms' }}
          >
            <span className="text-sm font-medium text-stone-500 mb-3 block">Quick access</span>
            <div className="grid grid-cols-2 gap-2.5">
              {quickLinks.map(({ to, label, Icon, hint }) => (
                <button
                  key={to}
                  onClick={() => navigate(to)}
                  className="group bg-card border border-stone-200 rounded-xl p-3 text-left hover:border-primary/40 hover:-translate-y-[1px] hover:shadow-sm transition-all"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <Icon size={18} className="text-stone-500 group-hover:text-primary transition-colors" />
                    <ArrowRight size={14} className="text-stone-300 group-hover:text-primary transition-colors" />
                  </div>
                  <div className="text-sm font-medium text-stone-800">{label}</div>
                  <div className="text-xs text-stone-400 mt-0.5 truncate">{hint}</div>
                </button>
              ))}
            </div>
          </article>

          {/* Connected drives — col-span-4 full width. */}
          <article
            className="lg:col-span-4 bento-reveal"
            style={{ animationDelay: '240ms' }}
          >
            <h2 className="text-sm font-medium text-stone-500 mb-3">Connected drives</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {drives.map((drive, i) => (
                <div
                  key={drive.id}
                  className="bg-card border border-stone-200 rounded-xl p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: getDriveColor(i) }}
                    >
                      <HardDrive size={16} color="white" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800 truncate">{drive.email}</div>
                      <div className="text-xs text-stone-400">
                        {drive.type === 'service_account' ? 'Service Account' : 'OAuth'}
                        {drive.isPrimary && <span className="ml-1.5 text-primary font-medium">· Primary</span>}
                      </div>
                    </div>
                  </div>
                  <QuotaBar used={drive.usedQuota} total={drive.totalQuota} color={getDriveColor(i)} showLabel={false} />
                  <div className="flex justify-between mt-2 text-xs text-stone-400">
                    <span>{formatFileSize(drive.usedQuota)} used</span>
                    <span>{drive.usagePercent}%</span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          {/* Recent files — col-span-3, big. */}
          <article
            className="lg:col-span-3 bg-card border border-stone-200 rounded-2xl overflow-hidden bento-reveal"
            style={{ animationDelay: '300ms' }}
          >
            <div className="flex items-center justify-between p-5 pb-3">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-stone-400" />
                <h2 className="text-sm font-medium text-stone-500">Recent</h2>
              </div>
              {hasRecent && (
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() => navigate('/files/root')}
                >
                  View all
                </button>
              )}
            </div>
            {hasRecent ? (
              <FileGrid
                files={recentFiles}
                subfolders={recentFolders}
                getDriveInfo={(driveAccountId) => {
                  if (!driveAccountId) return { drive: null, index: 0 };
                  const index = drives.findIndex((d) => d.id === driveAccountId);
                  if (index === -1) return { drive: drives[0] || null, index: 0 };
                  return { drive: drives[index], index };
                }}
                onShare={(id, type) => setShareTarget({ id, type })}
                onMoveDrive={(file) => setMoveDriveFiles([file])}
                onPreviewFile={setPreviewFile}
                isTargetShared={isTargetShared}
                viewMode="list"
              />
            ) : (
              <div className="p-8 text-center">
                <p className="text-sm text-stone-500">No recent files yet.</p>
                <button
                  className="mt-3 text-xs text-primary hover:underline"
                  onClick={() => navigate('/files/root')}
                >
                  Browse My Drive
                </button>
              </div>
            )}
          </article>

          {/* Admin tools — col-span-1, conditional. Fills last cell only for admins. */}
          {user?.role === 'super_admin' && (
            <article
              className="lg:col-span-1 bg-card border border-stone-200 rounded-2xl p-5 flex flex-col justify-between bento-reveal"
              style={{ animationDelay: '360ms' }}
            >
              <div>
                <div className="w-9 h-9 rounded-lg bg-stone-50 flex items-center justify-center mb-3">
                  <Users size={18} className="text-stone-500" />
                </div>
                <div className="text-sm font-medium text-stone-800">Admin tools</div>
                <p className="text-xs text-stone-400 mt-1">Manage users and invitations.</p>
              </div>
              <button
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:gap-2 transition-all"
                onClick={() => navigate('/admin/users')}
              >
                <Settings size={14} />
                Open
              </button>
            </article>
          )}
        </div>
      )}

      <ShareModal
        open={!!shareTarget}
        targetType={shareTarget?.type ?? 'file'}
        targetId={shareTarget?.id ?? ''}
        onClose={() => setShareTarget(null)}
      />

      {moveDriveFiles.length > 0 && (
        <MoveDriveModal
          files={moveDriveFiles}
          onClose={() => setMoveDriveFiles([])}
          onSuccess={() => {
            setMoveDriveFiles([]);
            refreshRecent();
          }}
          onError={(msg) => {
            console.error('Error moving file(s):', msg);
            addToast('error', 'Failed to move file(s)');
            setMoveDriveFiles([]);
          }}
        />
      )}

      <FilePreviewModal
        open={!!previewFile}
        file={previewFile ?? undefined}
        onClose={() => setPreviewFile(null)}
      />
    </div>
  );
}
