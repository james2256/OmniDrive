import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cn,
  formatFileSize,
  formatRelativeTime,
  formatDriveLabel,
  getDriveColor,
  getQuotaLevel,
  toLocalDatetimeInput,
  formatAbsoluteDate,
} from './utils';

// `utils.ts` is a grab-bag of pure formatting helpers. Tests use circular
// assertions (e.g. `formatAbsoluteDate(iso) === new Date(iso).toLocaleString(...)`)
// so they remain stable across locales, plus direct-string assertions for
// cases where the output is hardcoded (`'0 B'`, `'just now'`, etc.).

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('handles empty inputs', () => {
    expect(cn()).toBe('');
  });

  it('skips falsy values', () => {
    const showB = false;
    expect(cn('a', showB && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('flattens arrays', () => {
    expect(cn(['a', 'b'], 'c')).toBe('a b c');
  });

  it('merges conflicting Tailwind classes via twMerge (later wins)', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});

describe('formatFileSize', () => {
  it('0 → "0 B"', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('bytes < 1024 → "<n> B" (no decimals)', () => {
    expect(formatFileSize(1)).toBe('1 B');
    expect(formatFileSize(100)).toBe('100 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('1024 → "1.0 KB"', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('1536 → "1.5 KB"', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('1 MB (1048576) → "1.0 MB"', () => {
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });

  it('1 GB (1073741824) → "1.0 GB"', () => {
    expect(formatFileSize(1073741824)).toBe('1.0 GB');
  });

  it('1 TB (1099511627776) → "1.0 TB"', () => {
    expect(formatFileSize(1099511627776)).toBe('1.0 TB');
  });

  it('1 PB (1125899906842624) → "1.0 PB"', () => {
    expect(formatFileSize(1125899906842624)).toBe('1.0 PB');
  });

  it('caps unit index at PB (Math.min cap)', () => {
    // 1024^6 = 2^60 → without the Math.min cap, i=6 would access units[6]=undefined.
    // With the cap, i=5 (PB) and value overflows to 1024 PB-tier.
    expect(formatFileSize(1024 ** 6)).toBe('1024.0 PB');
  });

  it('negative bytes → "0 B" (graceful fallback)', () => {
    expect(formatFileSize(-1)).toBe('0 B');
    expect(formatFileSize(-1024)).toBe('0 B');
  });
});

describe('formatDriveLabel', () => {
  it('email → local part', () => {
    expect(formatDriveLabel('alex@gmail.com')).toBe('alex');
  });

  it('null → "Unknown"', () => {
    expect(formatDriveLabel(null)).toBe('Unknown');
  });

  it('undefined → "Unknown"', () => {
    expect(formatDriveLabel(undefined)).toBe('Unknown');
  });

  it('empty string → "Unknown"', () => {
    expect(formatDriveLabel('')).toBe('Unknown');
  });

  it('string without @ → unchanged', () => {
    expect(formatDriveLabel('nodomain')).toBe('nodomain');
  });

  it('local part of exactly 16 chars → unchanged', () => {
    expect(formatDriveLabel('abcdefghijklmnop@gmail.com')).toBe('abcdefghijklmnop');
  });

  it('long local part (>16 chars) → truncated to 14 chars + ellipsis', () => {
    expect(formatDriveLabel('abcdefghijklmnopqrstu@gmail.com')).toBe('abcdefghijklmn…');
  });
});

describe('getDriveColor', () => {
  it('index 0 → var(--drive-1)', () => {
    expect(getDriveColor(0)).toBe('var(--drive-1)');
  });

  it('index 4 → var(--drive-5)', () => {
    expect(getDriveColor(4)).toBe('var(--drive-5)');
  });

  it('index 5 wraps to var(--drive-1) (modulo)', () => {
    expect(getDriveColor(5)).toBe('var(--drive-1)');
  });

  it('index 6 wraps to var(--drive-2)', () => {
    expect(getDriveColor(6)).toBe('var(--drive-2)');
  });

  it('index 10 wraps to var(--drive-1)', () => {
    expect(getDriveColor(10)).toBe('var(--drive-1)');
  });

  it('negative index wraps correctly (modulo normalization)', () => {
    expect(getDriveColor(-1)).toBe('var(--drive-5)');
    expect(getDriveColor(-2)).toBe('var(--drive-4)');
    expect(getDriveColor(-4)).toBe('var(--drive-2)');
    expect(getDriveColor(-5)).toBe('var(--drive-1)');
  });
});

describe('formatAbsoluteDate', () => {
  const opts = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  } as const;

  it('ISO date string → formatted using toLocaleString', () => {
    const iso = '2024-06-15T12:00:00Z';
    expect(formatAbsoluteDate(iso)).toBe(new Date(iso).toLocaleString(undefined, opts));
  });

  it('SQLite format ("YYYY-MM-DD HH:MM:SS") → space replaced with "T" then parsed', () => {
    const sqlite = '2024-06-15 12:00:00';
    expect(formatAbsoluteDate(sqlite)).toBe(
      new Date('2024-06-15T12:00:00').toLocaleString(undefined, opts),
    );
  });

  it('epoch milliseconds (number) → formatted as date', () => {
    const epoch = 1718452800000; // 2024-06-15 12:00:00 UTC
    expect(formatAbsoluteDate(epoch)).toBe(new Date(epoch).toLocaleString(undefined, opts));
  });

  it('result contains the year (smoke test)', () => {
    expect(formatAbsoluteDate('2024-06-15T12:00:00Z')).toContain('2024');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('30s ago → "just now"', () => {
    expect(formatRelativeTime('2024-06-15T11:59:30Z')).toBe('just now');
  });

  it('0s ago (same instant) → "just now"', () => {
    expect(formatRelativeTime('2024-06-15T12:00:00Z')).toBe('just now');
  });

  it('5m ago → "5m ago"', () => {
    expect(formatRelativeTime('2024-06-15T11:55:00Z')).toBe('5m ago');
  });

  it('59m ago → "59m ago" (boundary just below 1 hour)', () => {
    expect(formatRelativeTime('2024-06-15T11:01:00Z')).toBe('59m ago');
  });

  it('2h ago → "2h ago"', () => {
    expect(formatRelativeTime('2024-06-15T10:00:00Z')).toBe('2h ago');
  });

  it('23h ago → "23h ago" (boundary just below 1 day)', () => {
    expect(formatRelativeTime('2024-06-14T13:00:00Z')).toBe('23h ago');
  });

  it('3d ago → "3d ago"', () => {
    expect(formatRelativeTime('2024-06-12T12:00:00Z')).toBe('3d ago');
  });

  it('6d ago → "6d ago" (boundary just below 7 days)', () => {
    expect(formatRelativeTime('2024-06-09T12:00:00Z')).toBe('6d ago');
  });

  it('10d ago → toLocaleDateString (>= 7 days falls through to absolute date)', () => {
    const tenDaysAgo = '2024-06-05T12:00:00Z';
    expect(formatRelativeTime(tenDaysAgo)).toBe(new Date(tenDaysAgo).toLocaleDateString());
  });

  it('future date → "just now" (negative diff is < 1 min)', () => {
    expect(formatRelativeTime('2024-06-15T12:00:30Z')).toBe('just now');
  });
});

describe('getQuotaLevel', () => {
  it('< 75 → "normal"', () => {
    expect(getQuotaLevel(0)).toBe('normal');
    expect(getQuotaLevel(50)).toBe('normal');
    expect(getQuotaLevel(74)).toBe('normal');
  });

  it('75-89 → "warning"', () => {
    expect(getQuotaLevel(75)).toBe('warning');
    expect(getQuotaLevel(89)).toBe('warning');
  });

  it('>= 90 → "danger"', () => {
    expect(getQuotaLevel(90)).toBe('danger');
    expect(getQuotaLevel(100)).toBe('danger');
    expect(getQuotaLevel(200)).toBe('danger');
  });
});

describe('toLocalDatetimeInput', () => {
  it('returns a YYYY-MM-DDThh:mm formatted string', () => {
    const result = toLocalDatetimeInput(new Date('2024-06-15T12:00:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('is exactly 16 characters (YYYY-MM-DDTHH:MM)', () => {
    const result = toLocalDatetimeInput(new Date('2024-06-15T12:00:00Z'));
    expect(result).toHaveLength(16);
  });

  it('round-trips the local datetime (matches Date with offset applied)', () => {
    // The function subtracts the timezone offset (ms) before calling toISOString.
    // For an arbitrary date, the expected output is the same expression the
    // source computes.
    const d = new Date('2024-06-15T12:00:00Z');
    const offsetMs = d.getTimezoneOffset() * 60_000;
    const expected = new Date(d.getTime() - offsetMs).toISOString().slice(0, 16);
    expect(toLocalDatetimeInput(d)).toBe(expected);
  });
});
