/**
 * Branch selection persisted per business so switching tenants cannot reuse
 * another business's branch UUID from localStorage.
 *
 * Keys:
 * - Primary: `khatario.<env>.branchId.<businessId>` (avoids dev/prod collisions if both use same browser profile)
 * - Legacy (read-only): `khatario.branchId.<businessId>` — migrated on write
 * - Ancient: `currentBranchId` — migrated when valid
 */

export const LEGACY_BRANCH_STORAGE_KEY = 'currentBranchId';

/** Original prefix before env segment was added (still read for migration). */
const LEGACY_PREFIX_NO_ENV = 'khatario.branchId.';

function storageEnvSegment(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_STORAGE_ENV) {
    return process.env.NEXT_PUBLIC_APP_STORAGE_ENV;
  }
  return process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
}

function primaryPrefix(): string {
  return `khatario.${storageEnvSegment()}.branchId.`;
}

/** Canonical write key (env-scoped). */
export function branchStorageKey(businessId: string): string {
  return `${primaryPrefix()}${businessId}`;
}

function legacyNoEnvKey(businessId: string): string {
  return `${LEGACY_PREFIX_NO_ENV}${businessId}`;
}

/** Whether a storage key is our branch selection for this business (multi-tab sync). */
export function isBranchStorageKeyForBusiness(storageKey: string | null, businessId: string): boolean {
  if (!storageKey || !businessId) return false;
  if (storageKey === LEGACY_BRANCH_STORAGE_KEY) return true;
  return storageKey === branchStorageKey(businessId) || storageKey === legacyNoEnvKey(businessId);
}

/** Clear value from all known key shapes for this business (used when invalidating). */
function removeAllKeysForBusiness(businessId: string): void {
  try {
    localStorage.removeItem(branchStorageKey(businessId));
    localStorage.removeItem(legacyNoEnvKey(businessId));
  } catch {
    /* ignore */
  }
}

function logInvalidBranchRemoved(
  reason: string,
  detail: { businessId: string; branchId?: string; storageKey?: string }
): void {
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[branch-storage] ${reason}`, detail);
  }
  // Hook for production logging (Sentry, etc.)
  if (typeof window !== 'undefined' && (window as unknown as { __KHATARIO_LOG_BRANCH?: (m: string, d: object) => void }).__KHATARIO_LOG_BRANCH) {
    (window as unknown as { __KHATARIO_LOG_BRANCH: (m: string, d: object) => void }).__KHATARIO_LOG_BRANCH(
      reason,
      detail
    );
  }
}

/**
 * Read branch id: env-scoped key first, then legacy no-env namespaced key.
 */
export function getNamespacedBranchId(businessId: string): string | null {
  if (typeof window === 'undefined') return null;
  const primary = localStorage.getItem(branchStorageKey(businessId));
  if (primary) return primary;
  return localStorage.getItem(legacyNoEnvKey(businessId));
}

export function setNamespacedBranchId(businessId: string, branchId: string | 'ALL'): void {
  if (typeof window === 'undefined' || !businessId) return;
  try {
    localStorage.setItem(branchStorageKey(businessId), branchId);
    localStorage.removeItem(legacyNoEnvKey(businessId));
    localStorage.removeItem(LEGACY_BRANCH_STORAGE_KEY);
  } catch {
    /* ignore quota */
  }
}

/**
 * If legacy global key points at a branch in this business (or ALL for admin),
 * copy to namespaced key and remove legacy. Otherwise drop legacy (wrong tenant).
 */
export function consumeLegacyBranchIfValid(
  businessId: string,
  branchList: { id: string }[],
  isAdmin: boolean
): string | 'ALL' | null {
  if (typeof window === 'undefined') return null;
  const legacy = localStorage.getItem(LEGACY_BRANCH_STORAGE_KEY);
  if (!legacy) return null;

  if (legacy === 'ALL') {
    if (!isAdmin) {
      try {
        localStorage.removeItem(LEGACY_BRANCH_STORAGE_KEY);
        logInvalidBranchRemoved('Removed invalid legacy branch key (ALL for non-admin)', { businessId });
      } catch {
        /* ignore */
      }
      return null;
    }
    setNamespacedBranchId(businessId, 'ALL');
    return 'ALL';
  }

  if (branchList.some((b) => b.id === legacy)) {
    setNamespacedBranchId(businessId, legacy);
    return legacy;
  }

  try {
    localStorage.removeItem(LEGACY_BRANCH_STORAGE_KEY);
    logInvalidBranchRemoved('Removed legacy branch id not in current business branch list', {
      businessId,
      branchId: legacy,
    });
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Drop namespaced value if it is not ALL and not in the current branch list (stale id).
 * Call only when branchList.length > 0 so we do not wipe valid ids before session branches load.
 */
export function invalidateStaleNamespacedBranch(
  businessId: string,
  branchList: { id: string }[]
): void {
  if (typeof window === 'undefined' || branchList.length === 0) return;
  const v = getNamespacedBranchId(businessId);
  if (!v || v === 'ALL') return;
  if (!branchList.some((b) => b.id === v)) {
    logInvalidBranchRemoved('Invalid branch id removed from storage (not in accessible branch list)', {
      businessId,
      branchId: v,
    });
    removeAllKeysForBusiness(businessId);
  }
}

/**
 * Active business id for non-React callers (cache only — session in AuthContext is source of truth).
 * Prefer passing business_id into buildApiUrl params when available.
 */
export function getActiveBusinessIdFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const direct = localStorage.getItem('businessId');
    if (direct) return direct;
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const u = JSON.parse(userStr) as { business_id?: string };
      if (u?.business_id) return u.business_id;
    }
    const bizStr = localStorage.getItem('business');
    if (bizStr) {
      const b = JSON.parse(bizStr) as { id?: string };
      if (b?.id) return b.id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Clear all per-business branch keys + legacy (call on logout). */
export function clearAllBranchStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(LEGACY_BRANCH_STORAGE_KEY);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith(primaryPrefix()) || k.startsWith(LEGACY_PREFIX_NO_ENV)) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}
