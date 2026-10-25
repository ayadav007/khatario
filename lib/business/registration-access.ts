import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';

export type RegistrationAccess =
  | { ok: true; businessId: string; userId: string }
  | { ok: false; response: NextResponse };

/** Session company and user. A body business id or user id is not accepted. */
export async function requireRegistrationAccess(
  request: NextRequest,
  action: 'read' | 'update',
): Promise<RegistrationAccess> {
  const businessId = getSessionScopedBusinessId(request);
  const userId = getAuthenticatedUserId(request);
  if (!businessId || !userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      ),
    };
  }
  try {
    await authorize(userId, 'settings', action, { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, response: error.toNextResponse() };
    }
    throw error;
  }
  return { ok: true, businessId, userId };
}

export function registrationMigrationResponse(error: unknown): NextResponse | null {
  const code = (error as { code?: string } | null)?.code;
  if (code === '42P01' || code === '42703') {
    return NextResponse.json(
      {
        error: 'Registration fields are not available until the database migration is applied',
        code: 'MIGRATION_REQUIRED',
      },
      { status: 503 },
    );
  }
  return null;
}
