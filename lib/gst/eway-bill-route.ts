import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { EwayBillInputError } from '@/lib/gst/eway-bills';

/** E-way bills are recorded under the invoices permission, as the invoice e-way field is. */
export async function authorizeEwayBill(
  request: NextRequest,
  action: 'read' | 'update'
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const planDenied = await denyIfFeatureMissing(businessId, 'eway_bill');
  if (planDenied) return { ok: false, response: planDenied };
  try {
    await authorize(userId, 'invoices', action, { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, userId, businessId };
}

export function ewayBillErrorResponse(error: any, fallback: string): NextResponse {
  if (error instanceof EwayBillInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error?.code === '22P02') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (error?.code === '23505') {
    return NextResponse.json({ error: 'This e-way bill number is already recorded.' }, { status: 409 });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback, details: error?.message }, { status: 500 });
}
