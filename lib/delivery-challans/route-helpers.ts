import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { ChallanInputError } from '@/lib/delivery-challans/challan';

/** Challans are issued under the invoices permission, matching the challan form's guard. */
export async function authorizeChallan(
  request: NextRequest,
  action: 'read' | 'create' | 'update'
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const userId = getUserIdFromRequest(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'invoices', action);
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, userId };
}

export function challanErrorResponse(error: any, fallback: string): NextResponse {
  if (error instanceof ChallanInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error?.code === '23505') {
    return NextResponse.json(
      { error: 'This challan number is already used. Change the number and try again.' },
      { status: 409 }
    );
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback, details: error?.message }, { status: 500 });
}
