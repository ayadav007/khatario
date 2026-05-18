/**
 * Authentication Helpers
 * Utilities to extract verified user information from requests.
 *
 * The middleware (middleware.ts) validates the JWT cookie and sets
 * trusted headers: x-authenticated-user-id, x-authenticated-business-id.
 * These helpers read those headers first, falling back to legacy
 * query-param / body patterns for backward compatibility during migration.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from './db';

export interface RequestUser {
  id: string;
  business_id: string;
  role_id: string | null;
}

/**
 * Get the authenticated user ID from the request.
 * Priority: middleware-injected header > legacy sources.
 */
export function getUserIdFromRequest(request: NextRequest, body?: any): string | null {
  // Trusted: set by middleware after JWT verification
  const verified = request.headers.get('x-authenticated-user-id');
  if (verified) return verified;

  // Legacy fallbacks (kept during migration; middleware still ensures auth)
  if (body?.user_id) return body.user_id;
  if (body?.created_by) return body.created_by;
  
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('user_id') || searchParams.get('userId');
  if (userId) return userId;
  
  const headerUserId = request.headers.get('x-user-id');
  if (headerUserId) return headerUserId;
  
  return null;
}

/**
 * Acting user id for create endpoints: prefers `created_by_user_id` or legacy `created_by`
 * in the JSON body, then session/header fallbacks via {@link getUserIdFromRequest}.
 */
export function resolveCreatedByUserId(
  request: NextRequest,
  body: Record<string, unknown> | null | undefined
): string | null {
  const explicit = body?.created_by_user_id ?? body?.created_by;
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim();
  }
  return getUserIdFromRequest(request, body);
}

/**
 * Get the authenticated business ID from the request.
 * Priority: JWT/middleware (`x-authenticated-business-id`), then legacy body/query params.
 */
export function getBusinessIdFromRequest(request: NextRequest, body?: any): string | null {
  const verified = request.headers.get('x-authenticated-business-id');
  if (verified) return verified;

  if (body?.business_id) return body.business_id;

  const { searchParams } = new URL(request.url);
  return searchParams.get('business_id');
}

/**
 * Active tenant from JWT/session only (set by middleware after validating the cookie).
 * Use when scoping SQL to business_id so URL/body `business_id` cannot override the authenticated company.
 */
export function getSessionScopedBusinessId(request: NextRequest): string | null {
  return request.headers.get('x-authenticated-business-id');
}

export type RequireTenantBusinessResult =
  | { ok: true; businessId: string }
  | { ok: false; response: NextResponse };

/**
 * Tenant-scoped business_id from JWT only. Rejects unauthenticated requests and
 * client `business_id` values that do not match the session (IDOR protection).
 */
export function requireTenantBusinessId(
  request: NextRequest,
  claimedBusinessId?: string | null
): RequireTenantBusinessResult {
  const businessId = getSessionScopedBusinessId(request);
  if (!businessId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const claimed =
    claimedBusinessId != null && String(claimedBusinessId).trim() !== ''
      ? String(claimedBusinessId).trim()
      : null;

  if (claimed && claimed !== businessId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Business ID does not match your session' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, businessId };
}

/**
 * Get user from request (with business_id and role_id).
 * Throws error if user not found.
 */
/**
 * Session version from middleware (must match users.auth_session_version).
 * Returns null if missing or invalid.
 */
export function getSessionVersionFromRequest(request: NextRequest): number | null {
  const h = request.headers.get('x-authenticated-session-version');
  if (h == null || h === '') return null;
  const n = Number(h);
  return Number.isFinite(n) ? n : null;
}

/**
 * Validates JWT session generation against the database for the given user.
 */
export async function assertUserSessionVersionMatches(
  request: NextRequest,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: 'header' | 'db' }> {
  const v = getSessionVersionFromRequest(request);
  if (v === null) return { ok: false, reason: 'header' };

  const row = await queryOne<{ auth_session_version: string }>(
    `SELECT auth_session_version::text AS auth_session_version
     FROM users WHERE id = $1 AND is_active = true`,
    [userId]
  );

  if (!row || Number(row.auth_session_version) !== v) {
    return { ok: false, reason: 'db' };
  }

  return { ok: true };
}

/**
 * Ensures cookie-authenticated API calls use a JWT session generation that still
 * matches the database (invalidates within the same request as authorize/enforceAccess).
 * Skips when no middleware user header (e.g. cron, scripts) or when acting user ≠ JWT user.
 */
export async function assertSessionValidForCookieAuth(userId: string): Promise<void> {
  const { headers } = await import('next/headers');
  const h = await headers();
  const mwUser = h.get('x-authenticated-user-id');
  if (!mwUser) {
    return;
  }
  if (mwUser !== userId) {
    const { AuthorizationError } = await import('./authorization');
    throw new AuthorizationError(
      'Actions must be performed as the signed-in user',
      'ACTOR_MISMATCH',
      undefined,
      403
    );
  }

  const svRaw = h.get('x-authenticated-session-version');
  if (svRaw == null || svRaw === '') {
    const { AuthorizationError } = await import('./authorization');
    throw new AuthorizationError('Session revoked', 'SESSION_REVOKED', undefined, 401);
  }
  const v = Number(svRaw);
  if (!Number.isFinite(v)) {
    const { AuthorizationError } = await import('./authorization');
    throw new AuthorizationError('Session revoked', 'SESSION_REVOKED', undefined, 401);
  }

  const row = await queryOne<{ auth_session_version: string }>(
    `SELECT auth_session_version::text AS auth_session_version
     FROM users WHERE id = $1 AND is_active = true`,
    [userId]
  );

  if (!row || Number(row.auth_session_version) !== v) {
    const { AuthorizationError } = await import('./authorization');
    throw new AuthorizationError('Session revoked', 'SESSION_REVOKED', undefined, 401);
  }
}

/**
 * For API routes that do not call {@link authorize} / {@link enforceAccess}.
 * Validates session generation when middleware set `x-authenticated-user-id`.
 */
export async function requirePortalSession(
  request: NextRequest
): Promise<NextResponse | null> {
  const userId = request.headers.get('x-authenticated-user-id');
  if (!userId) return null;
  try {
    await assertSessionValidForCookieAuth(userId);
    return null;
  } catch (e) {
    const { AuthorizationError } = await import('./authorization');
    if (e instanceof AuthorizationError) return e.toNextResponse();
    throw e;
  }
}

export async function getUserFromRequest(
  request: NextRequest,
  body?: any
): Promise<RequestUser> {
  const userId = getUserIdFromRequest(request, body);
  
  if (!userId) {
    throw new Error('Authentication required. No valid session found.');
  }

  await assertSessionValidForCookieAuth(userId);
  
  const user = await queryOne<RequestUser>(
    `SELECT id, business_id, role_id FROM users WHERE id = $1 AND is_active = true`,
    [userId]
  );
  
  if (!user) {
    throw new Error('User not found or inactive');
  }
  
  return user;
}
