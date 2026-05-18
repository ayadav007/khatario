/**
 * API Helper Utilities
 * Provides utilities for making API calls with proper authorization handling
 */

import {
  getActiveBusinessIdFromStorage,
  getNamespacedBranchId,
} from '@/lib/branch-storage';

/**
 * Resolve which business id to use for branch lookup.
 * Prefer explicit `business_id` on the request (aligns with session) over cache-only localStorage.
 */
function resolveBusinessIdForBranchInjection(
  params?: Record<string, string | number | boolean | null | undefined>
): string | null {
  const fromParams = params?.business_id;
  if (fromParams !== undefined && fromParams !== null && fromParams !== '') {
    return String(fromParams);
  }
  return getActiveBusinessIdFromStorage();
}

/**
 * Get current branch ID from storage for non-React callers (e.g. useEntityList).
 * Uses per-business namespaced storage; business id should match the API request.
 */
function getCurrentBranchIdFromStorageForBusiness(businessId: string | null): string | 'ALL' | null {
  if (typeof window === 'undefined' || !businessId) return null;
  const v = getNamespacedBranchId(businessId);
  return v ? (v as string | 'ALL') : null;
}

/**
 * Build API URL with required query parameters (user_id, business_id, branch_id)
 * Automatically includes branch_id from global branch context unless explicitly excluded
 */
export function buildApiUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  options?: { excludeBranchId?: boolean }
): string {
  const url = new URL(endpoint, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  
  // Get user_id from localStorage if available
  if (typeof window !== 'undefined') {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user?.id) {
          url.searchParams.append('user_id', user.id);
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  // Automatically add branch_id from storage for the same business as the request
  // Only add if not already in params and not excluded
  if (!options?.excludeBranchId && (!params || !('branch_id' in params))) {
    const businessIdForBranch = resolveBusinessIdForBranchInjection(params);
    const currentBranchId = getCurrentBranchIdFromStorageForBusiness(businessIdForBranch);
    if (currentBranchId && currentBranchId !== 'ALL') {
      url.searchParams.append('branch_id', currentBranchId);
    } else if (currentBranchId === 'ALL') {
      url.searchParams.append('branch_id', 'ALL');
    }
  }

  // Add other params
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.append(key, String(value));
      }
    });
  }

  return url.pathname + url.search;
}

/**
 * Use with financial report PDF URLs when opening in a new tab to print.
 * API routes set Content-Disposition: inline when `inline=1` is present so
 * the browser shows the PDF instead of forcing download.
 */
export function forPdfPrintInBrowser(pathWithQuery: string): string {
  const sep = pathWithQuery.includes('?') ? '&' : '?';
  return `${pathWithQuery}${sep}inline=1`;
}

/**
 * Build request body with user_id included
 */
export function buildRequestBody(
  body: Record<string, any>,
  options?: { includeUserId?: boolean; userIdField?: string }
): Record<string, any> {
  const { includeUserId = true, userIdField = 'created_by' } = options || {};
  
  if (includeUserId && typeof window !== 'undefined') {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        if (user?.id) {
          body[userIdField] = user.id;
        }
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  return body;
}

/**
 * Make API call with automatic user_id and branch_id injection
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit & {
    params?: Record<string, string | number | boolean | null | undefined>;
    body?: Record<string, any>;
    includeUserId?: boolean;
    excludeBranchId?: boolean; // Set to true to exclude branch_id from this call
  } = {}
): Promise<Response> {
  const { params, body, includeUserId = true, excludeBranchId = false, ...fetchOptions } = options;

  // Build URL with params, user_id, and branch_id (unless excluded)
  const url = buildApiUrl(endpoint, params, { excludeBranchId });

  // Build request options
  const requestOptions: RequestInit = {
    ...fetchOptions,
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
  };

  // Add body with user_id if provided
  if (body) {
    requestOptions.body = JSON.stringify(buildRequestBody(body, { includeUserId }));
  }

  return fetch(url, requestOptions);
}
