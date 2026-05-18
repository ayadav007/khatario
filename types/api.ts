export interface ApiCallResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  errorDetails?: any;
  isAuthorizationError?: boolean;
  /** Set when API returned 403 + FEATURE_NOT_IN_PLAN (global upgrade modal handles UI). */
  isPlanFeatureDenied?: boolean;
  /** Backend `feature` key when denied. */
  featureKey?: string;
}
