import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import {
  isReceiptShortfallMode,
  readReceiptShortfallMode,
  saveReceiptShortfallMode,
} from '@/lib/purchases/receipt-shortfall-mode';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/receipt-shortfall — { mode: 'keep' | 'auto_return' }
 * PATCH { mode } — what receiving a Supplier Hub bill does with short and damaged quantities
 * (lib/purchases/receipt-shortfall-mode). Business and user come from the session only.
 */
async function sessionScope(request: NextRequest, action: 'read' | 'update') {
  const businessId = getSessionScopedBusinessId(request);
  const userId = getAuthenticatedUserId(request);
  if (!businessId || !userId) {
    return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'settings', action, { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { response: error.toNextResponse() };
    throw error;
  }
  return { businessId };
}

export async function GET(request: NextRequest) {
  try {
    const scope = await sessionScope(request, 'read');
    if (!scope.businessId) return scope.response;
    return NextResponse.json({ mode: await readReceiptShortfallMode(scope.businessId) });
  } catch (error: any) {
    console.error('[receipt-shortfall GET]', error);
    return NextResponse.json({ error: 'Could not load the setting' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const scope = await sessionScope(request, 'update');
    if (!scope.businessId) return scope.response;
    if (!isReceiptShortfallMode(body?.mode)) {
      return NextResponse.json({ error: "mode must be 'keep' or 'auto_return'" }, { status: 400 });
    }
    return NextResponse.json({ mode: await saveReceiptShortfallMode(scope.businessId, body.mode) });
  } catch (error: any) {
    console.error('[receipt-shortfall PATCH]', error);
    return NextResponse.json({ error: 'Could not save the setting' }, { status: 500 });
  }
}
