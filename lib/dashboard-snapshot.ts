/**
 * Persists last-known dashboard overview for offline viewing.
 * Keyed by business, user, and date range.
 */

const STORAGE_PREFIX = 'offline_dashboard_';

export interface DashboardSnapshot {
  businessId: string;
  userId: string;
  dateRangeKey: string;
  data: Record<string, unknown>;
  timestamp: number;
}

function getStorageKey(
  businessId: string,
  userId: string,
  dateRangeKey: string
): string {
  return `${STORAGE_PREFIX}${businessId}_${userId}_${dateRangeKey}`;
}

export function saveDashboardSnapshot(
  businessId: string,
  userId: string,
  dateRangeKey: string,
  data: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: DashboardSnapshot = {
      businessId,
      userId,
      dateRangeKey,
      data,
      timestamp: Date.now(),
    };
    localStorage.setItem(
      getStorageKey(businessId, userId, dateRangeKey),
      JSON.stringify(payload)
    );
  } catch (e) {
    console.warn('[DashboardSnapshot] Save failed:', e);
  }
}

export function loadDashboardSnapshot(
  businessId: string,
  userId: string,
  dateRangeKey: string
): DashboardSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(
      getStorageKey(businessId, userId, dateRangeKey)
    );
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DashboardSnapshot;
    if (!parsed?.businessId || !parsed?.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDashboardSnapshotsForUser(
  businessId: string,
  userId: string
): void {
  if (typeof window === 'undefined') return;
  const prefix = `${STORAGE_PREFIX}${businessId}_${userId}_`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function clearAllDashboardSnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
