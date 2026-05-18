import { NextRequest, NextResponse } from 'next/server';
import {
  getPlatformAdminIfSessionValid,
  hasMinimumRole,
  hasPermission,
  type PlatformAdmin,
} from '@/lib/platform-auth';
import { verifyPlatformAccessToken, PLATFORM_ACCESS_COOKIE } from '@/lib/platform-jwt';

function getVerifiedPlatformSessionFromRequest(request: NextRequest): {
  adminId: string;
  sessionVersion: number;
} | null {
  const headerId = request.headers.get('x-platform-admin-id')?.trim();
  const headerSv = request.headers.get('x-platform-admin-session-version');
  if (headerId && headerSv != null && headerSv !== '') {
    const sv = Number(headerSv);
    if (Number.isFinite(sv)) {
      return { adminId: headerId, sessionVersion: sv };
    }
  }
  return null;
}

export type PlatformRequestAuthResult =
  | { ok: true; admin: PlatformAdmin }
  | { ok: false; response: NextResponse };

/**
 * Resolve platform admin from httpOnly JWT cookie (verified in middleware) or cookie + DB session.
 * Client-supplied x-admin-id is not trusted.
 */
export async function requirePlatformRequest(
  request: NextRequest,
  minRole: string = 'viewer',
  requiredPermission?: string
): Promise<PlatformRequestAuthResult> {
  let adminId: string | null = null;
  let sessionVersion: number | null = null;

  const fromHeaders = getVerifiedPlatformSessionFromRequest(request);
  if (fromHeaders) {
    adminId = fromHeaders.adminId;
    sessionVersion = fromHeaders.sessionVersion;
  } else {
    const token = request.cookies.get(PLATFORM_ACCESS_COOKIE)?.value;
    const payload = token ? await verifyPlatformAccessToken(token) : null;
    if (payload) {
      adminId = payload.adminId;
      sessionVersion = payload.sv;
    }
  }

  if (!adminId || sessionVersion == null) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required', code: 'NO_ADMIN_SESSION' },
        { status: 401 }
      ),
    };
  }

  const sessionAdmin = await getPlatformAdminIfSessionValid(adminId, sessionVersion);
  if (!sessionAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Session expired or revoked', code: 'PLATFORM_SESSION_INVALID' },
        { status: 401 }
      ),
    };
  }

  if (!hasMinimumRole(sessionAdmin, minRole)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Insufficient role. Required: ${minRole}, Current: ${sessionAdmin.role}`,
          code: 'FORBIDDEN',
        },
        { status: 403 }
      ),
    };
  }

  if (requiredPermission && !hasPermission(sessionAdmin, requiredPermission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Missing permission: ${requiredPermission}`, code: 'FORBIDDEN' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, admin: sessionAdmin };
}
