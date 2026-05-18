'use client';

import { useCallback } from 'react';
import { useFeatureUpgradeModal } from '@/contexts/FeatureUpgradeModalContext';
import type { ApiCallResult } from '@/types/api';

/**
 * Wrapper for fetch calls that:
 * – Opens the global upgrade modal on 403 + FEATURE_NOT_IN_PLAN (and legacy FEATURE_NOT_AVAILABLE)
 * – Routes other API errors unchanged
 *
 * Modal UI is provided by {@link FeatureUpgradeModalProvider} in `app/(app)/layout.tsx`.
 */
export function useApiErrorHandler() {
  const { openIfFeatureDeniedResponse } = useFeatureUpgradeModal();

  /**
   * Parse response and normalize error handling — use with any GET/POST that may return feature denial.
   */
  const handleApiCall = useCallback(
    async <T,>(
      apiCall: () => Promise<Response>
    ): Promise<ApiCallResult<T>> => {
      try {
        const response = await apiCall();

        const text = await response.text();
        let data: Record<string, unknown> = {};
        try {
          if (text?.trim()) {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              data = parsed as Record<string, unknown>;
            }
          }
        } catch {
          if (!response.ok) {
            return { success: false, error: 'Invalid response from server' };
          }
          return { success: false, error: 'Failed to parse response' };
        }

        if (!response.ok) {
          const featureKey =
            typeof data.feature === 'string' ? data.feature : undefined;

          if (openIfFeatureDeniedResponse(response.status, data)) {
            return {
              success: false,
              error:
                typeof data.error === 'string'
                  ? data.error
                  : 'Feature not available in your plan',
              isPlanFeatureDenied: true,
              featureKey,
            };
          }

          if (
            response.status === 403 &&
            (data.code === 'ACCESS_DENIED' ||
              data.code === 'MODULE_PERMISSION_DENIED' ||
              data.code === 'BRANCH_ACCESS_DENIED' ||
              data.code === 'WAREHOUSE_ACCESS_DENIED' ||
              data.code === 'BRANCH_TRANSACTION_PERMISSION_DENIED' ||
              data.code === 'WAREHOUSE_TRANSACTION_PERMISSION_DENIED' ||
              data.code === 'AUTHENTICATION_REQUIRED')
          ) {
            return {
              success: false,
              error:
                typeof data.error === 'string' ? data.error : 'Access Denied',
              errorCode:
                typeof data.code === 'string' ? data.code : undefined,
              errorDetails: data.details,
              isAuthorizationError: true,
            };
          }

          return {
            success: false,
            error:
              typeof data.error === 'string'
                ? data.error
                : 'An error occurred',
          };
        }

        return { success: true, data: data as T };
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Network error';
        return { success: false, error: message };
      }
    },
    [openIfFeatureDeniedResponse]
  );

  return { handleApiCall };
}
