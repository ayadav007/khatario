import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import {
  assertOperationalSubscription,
} from '@/lib/security/require-operational-subscription';

type Gstr2bAction = 'read' | 'create';

export async function assertGstr2bApiAccess(
  request: NextRequest,
  claimedBusinessId: string | null | undefined,
  action: Gstr2bAction
): Promise<
  | { ok: true; businessId: string; userId: string }
  | { ok: false; response: NextResponse }
> {
  const tenant = requireTenantBusinessId(request, claimedBusinessId);
  if (!tenant.ok) return { ok: false, response: tenant.response };

  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }

  const subscriptionGate = await assertOperationalSubscription(tenant.businessId);
  if (!subscriptionGate.ok) {
    return { ok: false, response: subscriptionGate.response };
  }

  try {
    await assertReportAccess(tenant.businessId, 'gst');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return { ok: false, response: error.toNextResponse() };
    }
    throw error;
  }

  try {
    await authorize(userId, 'report.gst', action, { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, response: error.toNextResponse() };
    }
    throw error;
  }

  return { ok: true, businessId: tenant.businessId, userId };
}
