/**
 * Centralized API Client Utilities
 * Provides consistent error handling for authorization errors
 */

export interface ApiError {
  error: string;
  code?: string;
  details?: any;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError | string;
  isAuthorizationError?: boolean;
}

/**
 * Check if an error is an authorization error (403)
 */
export function isAuthorizationError(error: any): boolean {
  if (!error) return false;
  
  // Check if it's a Response object
  if (error instanceof Response) {
    return error.status === 403;
  }
  
  // Check if it's an error object with code
  const errorCodes = [
    'ACCESS_DENIED',
    'MODULE_PERMISSION_DENIED',
    'BRANCH_ACCESS_DENIED',
    'WAREHOUSE_ACCESS_DENIED',
    'BRANCH_TRANSACTION_PERMISSION_DENIED',
    'WAREHOUSE_TRANSACTION_PERMISSION_DENIED',
    'AUTHENTICATION_REQUIRED',
  ];
  
  return error.code && errorCodes.includes(error.code);
}

/**
 * Extract error message from API response
 */
export function extractErrorMessage(error: any): string {
  if (typeof error === 'string') return error;
  if (error?.error) return error.error;
  if (error?.message) return error.message;
  return 'An error occurred';
}

/**
 * Extract error code from API response
 */
export function extractErrorCode(error: any): string | undefined {
  if (error?.code) return error.code;
  if (error?.errorCode) return error.errorCode;
  return undefined;
}

/**
 * Make an API call with automatic authorization error handling
 */
export async function apiCall<T>(
  url: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      const isAuthError = isAuthorizationError({ code: data.code });
      
      return {
        success: false,
        error: data,
        isAuthorizationError: isAuthError,
      };
    }

    return {
      success: true,
      data: data as T,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Network error',
    };
  }
}
