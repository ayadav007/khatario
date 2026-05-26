/**
 * Tracks global last-successful sync time for stale-data UI.
 */

const GLOBAL_SYNC_KEY = 'khatario_last_sync_at';

export function markAppSynced(at: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GLOBAL_SYNC_KEY, String(at));
  } catch {
    /* ignore */
  }
}

export function getLastAppSyncAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GLOBAL_SYNC_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function formatLastSyncedLabel(timestamp: number | null): string | null {
  if (!timestamp) return null;
  const ageMs = Date.now() - timestamp;
  if (ageMs < 60_000) return 'just now';
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
