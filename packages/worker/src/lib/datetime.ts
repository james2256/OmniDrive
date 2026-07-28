/**
 * Convert a Date to SQLite datetime('now') format: "YYYY-MM-DD HH:MM:SS" (UTC, space separator).
 *
 * SQLite TEXT columns using DEFAULT (datetime('now')) store this format. Comparing
 * such a column against ISO 8601 ("YYYY-MM-DDTHH:MM:SS.sssZ") lexicographically is
 * incorrect because space (0x20) < T (0x54) — files on the same day as the cutoff
 * would be ordered wrong. Always convert Date values to this format before binding
 * them into a query that compares against a datetime('now') column.
 */
export function toSQLiteDatetime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}
