/**
 * A DATE column value as YYYY-MM-DD. node-pg returns DATE as a local-midnight Date, so take its local
 * calendar day (toISOString would shift it in time zones ahead of UTC); strings pass through.
 */
export function dateColumnToYmd(v: unknown): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}
