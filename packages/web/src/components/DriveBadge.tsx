import { cn, formatDriveLabel, getDriveColor } from '../lib/utils';

interface DriveBadgeProps {
  email?: string | null;
  colorIndex: number;
  size?: 'sm' | 'md';
  className?: string;
}

export function DriveBadge({ email, colorIndex, size = 'sm', className }: DriveBadgeProps) {
  const color = getDriveColor(colorIndex);
  const label = formatDriveLabel(email);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium shrink-0',
        size === 'sm' ? 'text-[10px] px-2 py-0.5 max-w-[150px]' : 'text-xs px-2.5 py-1 max-w-[180px]',
        className
      )}
      style={{ borderColor: color, color }}
      title={email ?? undefined}
    >
      <span
        className={cn('rounded-full shrink-0', size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5')}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
    </span>
  );
}