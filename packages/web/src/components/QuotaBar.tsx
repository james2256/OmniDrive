import { formatFileSize, getQuotaLevel } from '../lib/utils';

interface QuotaBarProps {
  used: number;
  total: number;
  color?: string;
  showLabel?: boolean;
}

export function QuotaBar({ used, total, color, showLabel = true }: QuotaBarProps) {
  const percent = total > 0 ? (used / total) * 100 : 0;
  const level = getQuotaLevel(percent);

  const defaultColor =
    level === 'danger'  ? '#ef4444' :
    level === 'warning' ? '#f59e0b' :
    '#3b82f6';

  const barColor = color ?? defaultColor;

  return (
    <div>
      <div className="h-1.5 w-full bg-stone-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(percent, 100)}%`,
            backgroundColor: barColor,
          }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between mt-1.5 text-xs text-stone-400">
          <span>{formatFileSize(used)} used</span>
          <span>{formatFileSize(total)} total</span>
        </div>
      )}
    </div>
  );
}
