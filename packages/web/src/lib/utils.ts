import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}



/** Short label for a connected drive account — local-part only (no @domain). */
export function formatDriveLabel(email?: string | null): string {
  if (!email) return 'Unknown';
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  if (local.length <= 16) return local;
  return `${local.slice(0, 14)}…`;
}

export function getDriveColor(index: number): string {
  const colors = [
    'var(--drive-1)',
    'var(--drive-2)',
    'var(--drive-3)',
    'var(--drive-4)',
    'var(--drive-5)',
  ];
  return colors[index % colors.length];
}

export function getQuotaLevel(percent: number): 'normal' | 'warning' | 'danger' {
  if (percent >= 90) return 'danger';
  if (percent >= 75) return 'warning';
  return 'normal';
}
