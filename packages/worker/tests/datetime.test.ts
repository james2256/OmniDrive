import { describe, it, expect } from 'vitest';
import { toSQLiteDatetime } from '../src/lib/datetime';

describe('toSQLiteDatetime', () => {
  it('formats a UTC date as "YYYY-MM-DD HH:MM:SS" (space separator, no T, no millis)', () => {
    // 2024-01-15T13:45:30.123Z
    const date = new Date('2024-01-15T13:45:30.123Z');
    expect(toSQLiteDatetime(date)).toBe('2024-01-15 13:45:30');
  });

  it('strips millisecond precision', () => {
    const withMs = new Date('2024-06-30T23:59:59.999Z');
    expect(toSQLiteDatetime(withMs)).toBe('2024-06-30 23:59:59');
  });

  it('zero-pads single-digit month, day, hour, minute, second', () => {
    const date = new Date('2024-02-03T04:05:06.000Z');
    expect(toSQLiteDatetime(date)).toBe('2024-02-03 04:05:06');
  });

  it('preserves UTC (does not shift to local timezone)', () => {
    // Same instant in two constructions → same output regardless of any TZ env
    const a = new Date('2024-12-31T23:59:59.000Z');
    const b = new Date(Date.UTC(2024, 11, 31, 23, 59, 59));
    expect(toSQLiteDatetime(a)).toBe('2024-12-31 23:59:59');
    expect(toSQLiteDatetime(b)).toBe('2024-12-31 23:59:59');
  });

  it('round-trips across lexicographically sortable boundary (YYYY-MM-DD HH:MM:SS sorts correctly)', () => {
    // Two timestamps one second apart — string compare agrees with chronological order.
    const earlier = toSQLiteDatetime(new Date('2024-01-15T13:45:29.000Z'));
    const later = toSQLiteDatetime(new Date('2024-01-15T13:45:30.000Z'));
    expect(earlier < later).toBe(true);
  });

  it('does NOT produce ISO 8601 with "T" (which would sort wrong vs datetime(\'now\'))', () => {
    const date = new Date('2024-01-15T13:45:30.000Z');
    const out = toSQLiteDatetime(date);
    expect(out).not.toContain('T');
    expect(out).not.toContain('Z');
    expect(out).not.toContain('.');
  });

  it('handles epoch (1970-01-01 00:00:00)', () => {
    expect(toSQLiteDatetime(new Date(0))).toBe('1970-01-01 00:00:00');
  });

  it('handles end-of-day timestamps cleanly', () => {
    expect(toSQLiteDatetime(new Date('2024-01-31T23:59:59.000Z'))).toBe('2024-01-31 23:59:59');
  });
});
