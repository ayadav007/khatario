/**
 * Unified Capability Snapshot for Offline-First PWA
 *
 * Persists last-known server state (permissions, subscription, features)
 * so the client can render correctly when offline.
 *
 * Server remains source of truth. Client logic is UX only.
 */

export interface ModulePermission {
  can_view: boolean;
  can_add: boolean;
  can_modify: boolean;
  can_delete: boolean;
  can_share: boolean;
}

export interface Subscription {
  id: string;
  business_id: string;
  plan_id: string;
  status: string;
  plan_name?: string;
  plan_display_name?: string;
  features?: {
    features?: Record<string, boolean>;
    limits?: Record<string, number>;
  };
  [key: string]: unknown;
}

export interface Addon {
  id: string;
  business_id: string;
  addon_type: string;
  status: string;
  end_date?: string;
  [key: string]: unknown;
}

export interface CapabilitySnapshot {
  businessId: string;
  userId: string;
  permissions: Record<string, ModulePermission>;
  isPrimaryAdmin: boolean;
  subscription: Subscription | null;
  addons: Addon[];
  enabledFeatures: string[];
  timestamp: number;
}

const STORAGE_PREFIX = 'offline_capability_';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getStorageKey(businessId: string, userId: string): string {
  return `${STORAGE_PREFIX}${businessId}_${userId}`;
}

/**
 * Save capability snapshot to localStorage.
 * Key: offline_capability_${businessId}_${userId}
 */
export function saveCapabilitySnapshot(snapshot: CapabilitySnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(snapshot.businessId, snapshot.userId);
    const payload = {
      ...snapshot,
      timestamp: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {
    console.warn('[CapabilitySnapshot] Save failed:', e);
  }
}

/**
 * Load capability snapshot from localStorage.
 * Returns null if not found or invalid.
 */
export function loadCapabilitySnapshot(
  businessId: string,
  userId: string
): CapabilitySnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = getStorageKey(businessId, userId);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw) as CapabilitySnapshot;
    if (!data?.businessId || !data?.userId) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Clear capability snapshot for tenant.
 * Call on logout.
 */
export function clearCapabilitySnapshot(
  businessId: string,
  userId: string
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = getStorageKey(businessId, userId);
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

/**
 * Clear all capability snapshots (e.g. full logout).
 */
export function clearAllCapabilitySnapshots(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Ignore
  }
}

/**
 * Check if snapshot has expired.
 * @param snapshot - Loaded snapshot
 * @param ttlMs - Time-to-live in milliseconds (default 24h)
 */
export function isSnapshotExpired(
  snapshot: CapabilitySnapshot,
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  const age = Date.now() - (snapshot.timestamp || 0);
  return age > ttlMs;
}
