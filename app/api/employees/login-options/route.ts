import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { loadEmployeeLoginOptions } from '@/lib/hr/employee-login-options';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/login-options
 * Roles the current user may assign, and whether a login seat is free.
 */
export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;
    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      await authorize(userId, 'employees', 'create', { businessId: tenant.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        try {
          await authorize(userId, 'employees', 'update', { businessId: tenant.businessId });
        } catch (updateError) {
          if (updateError instanceof AuthorizationError) return updateError.toNextResponse();
          throw updateError;
        }
      } else {
        throw error;
      }
    }

    const options = await loadEmployeeLoginOptions(tenant.businessId, userId);
    return NextResponse.json(options);
  } catch (error: unknown) {
    console.error('Error loading employee login options:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
