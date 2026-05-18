'use client';

import { useState, useCallback } from 'react';
import { useToast } from './useToast';

interface AuthorizationError {
  message: string;
  code?: string;
  details?: any;
}

/**
 * Hook for handling authorization errors (403)
 * Provides utilities to check and display authorization errors
 */
export function useAuthorizationError() {
  const { error: showErrorToast } = useToast();
  const [accessDenied, setAccessDenied] = useState<AuthorizationError | null>(null);

  /**
   * Check if an API response is an authorization error
   */
  const isAuthorizationError = useCallback((response: Response, data?: any): boolean => {
    if (response.status !== 403) return false;
    
    const errorCodes = [
      'ACCESS_DENIED',
      'MODULE_PERMISSION_DENIED',
      'BRANCH_ACCESS_DENIED',
      'WAREHOUSE_ACCESS_DENIED',
      'BRANCH_TRANSACTION_PERMISSION_DENIED',
      'WAREHOUSE_TRANSACTION_PERMISSION_DENIED',
      'AUTHENTICATION_REQUIRED',
    ];
    
    return data?.code && errorCodes.includes(data.code);
  }, []);

  /**
   * Handle authorization error from API response
   */
  const handleAuthorizationError = useCallback((error: any, showToast: boolean = true) => {
    const errorMessage = error?.error || error?.message || 'Access Denied';
    const errorCode = error?.code || error?.errorCode;
    const errorDetails = error?.details || error?.errorDetails;

    setAccessDenied({
      message: errorMessage,
      code: errorCode,
      details: errorDetails,
    });

    if (showToast) {
      showErrorToast(errorMessage);
    }
  }, [showErrorToast]);

  /**
   * Clear access denied state
   */
  const clearAccessDenied = useCallback(() => {
    setAccessDenied(null);
  }, []);

  /**
   * Wrapper for API calls that automatically handles authorization errors
   */
  const handleApiCall = useCallback(async <T,>(
    apiCall: () => Promise<Response>,
    options?: { showToast?: boolean; onError?: (error: any) => void }
  ): Promise<{ success: boolean; data?: T; error?: any }> => {
    try {
      const response = await apiCall();
      const data = await response.json();

      if (!response.ok) {
        if (isAuthorizationError(response, data)) {
          handleAuthorizationError(data, options?.showToast ?? true);
          if (options?.onError) {
            options.onError(data);
          }
          return { success: false, error: data };
        }

        // Other errors
        return { success: false, error: data.error || 'An error occurred' };
      }

      return { success: true, data: data as T };
    } catch (error: any) {
      return { success: false, error: error.message || 'Network error' };
    }
  }, [isAuthorizationError, handleAuthorizationError]);

  return {
    accessDenied,
    isAuthorizationError,
    handleAuthorizationError,
    clearAccessDenied,
    handleApiCall,
  };
}
