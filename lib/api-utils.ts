/**
 * Safely parse a JSON response body, returning null if parsing fails.
 */
export async function safeJsonParse<T = Record<string, unknown>>(
  response: Response
): Promise<T | null> {
  try {
    const text = await response.text();
    if (!text || text.trim().length === 0) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Client-safe helper: API may return FEATURE_NOT_IN_PLAN (canonical) or legacy FEATURE_NOT_AVAILABLE.
 */
function isFeaturePlanDeniedCode(code: unknown): boolean {
  return code === 'FEATURE_NOT_IN_PLAN' || code === 'FEATURE_NOT_AVAILABLE';
}

/**
 * Extract a user-friendly error message from an API error response.
 * Handles feature-denied, authorization, and generic errors.
 */
export function getApiErrorMessage(
  data: Record<string, unknown> | null,
  fallback = 'Something went wrong. Please try again.'
): string {
  if (!data) return fallback;

  if (isFeaturePlanDeniedCode(data.code)) {
    return (data.error as string) || 'This feature is not available in your current plan. Please upgrade.';
  }

  if (data.code === 'ACCESS_DENIED' || data.code === 'AUTHORIZATION_DENIED') {
    return (data.error as string) || 'You do not have permission to perform this action.';
  }

  if (data.code === 'PERIOD_LOCKED') {
    return (data.error as string) || 'This accounting period is locked.';
  }

  if (data.code === 'BACKDATE_EXCEEDS_LIMIT' || data.code === 'BACKDATE_APPROVAL_REQUIRED') {
    return (data.error as string) || 'Backdated entry not allowed.';
  }

  if (data.code === 'WAREHOUSE_ACCESS_DENIED' || data.code === 'WAREHOUSE_REQUIRED') {
    return (data.error as string) || 'Warehouse access denied.';
  }

  if (
    data.code === 'DUPLICATE_CUSTOMER' ||
    data.code === 'DUPLICATE_SUPPLIER' ||
    data.code === 'OPENING_BALANCE_LOCKED' ||
    data.code === 'INVALID_PHONE'
  ) {
    return (data.error as string) || fallback;
  }

  const base = (data.error as string) || (data.message as string);
  const details = typeof data.details === 'string' ? data.details.trim() : '';
  if (base) {
    if (details && !base.includes(details)) {
      return `${base} (${details})`;
    }
    return base;
  }
  if (details) return details;
  return fallback;
}

export { isLikelyNetworkFetchError, shouldSuppressOfflineToast } from '@/lib/network/errors';

/**
 * Check if an error response indicates the feature is not available on the plan.
 */
export function isFeatureDenied(data: Record<string, unknown> | null): boolean {
  return isFeaturePlanDeniedCode(data?.code);
}

/**
 * Combined check for API responses: 403 plus plan feature denial (`code` on body).
 * Use after parsing JSON alongside `response.status`.
 */
export function isFeatureDeniedResponse(
  status: number,
  data: Record<string, unknown> | null
): boolean {
  return status === 403 && isFeatureDenied(data);
}
