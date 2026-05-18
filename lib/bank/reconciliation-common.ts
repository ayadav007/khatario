export function parseMatchedLedgerIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === 'object') return Object.values(raw as object).map(String);
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

const MS_DAY = 86_400_000;

export function bankLineAgeDays(transactionDateYmd: string, asOf: Date = new Date()): number {
  const t = new Date(`${transactionDateYmd}T12:00:00`);
  if (!Number.isFinite(t.getTime())) return 0;
  return Math.max(0, Math.floor((asOf.getTime() - t.getTime()) / MS_DAY));
}
