/**
 * Platform admin APIs authenticate via httpOnly `khatario_platform_session` cookie.
 * Always use {@link platformAdminFetchInit} (or `credentials: 'include'`) for /api/admin/* and /api/policies.
 */
export const platformAdminFetchInit: RequestInit = { credentials: 'include' };

/** @deprecated No headers required; cookie is sent automatically with credentials: 'include'. */
export function platformAdminAuthHeaders(_adminId?: string): Record<string, string> {
  return {};
}
