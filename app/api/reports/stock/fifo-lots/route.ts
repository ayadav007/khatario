import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { buildFifoLotReport } from '@/lib/inventory/fifo-report';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/reports/stock/fifo-lots?item_id=&as_on_date=
 * FIFO cost lots per item (opening stock, bills, credit notes, stock found), the documents that
 * consumed each lot, quantity sold without stock, and open-lot value against the 1104 balance.
 */
export async function GET(request: NextRequest) {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const itemId = searchParams.get('item_id') || null;
  const asOf = searchParams.get('as_on_date') || null;
  if (itemId && !UUID.test(itemId)) return NextResponse.json({ error: 'Invalid item_id' }, { status: 400 });
  if (asOf && !DATE.test(asOf)) return NextResponse.json({ error: 'as_on_date must be YYYY-MM-DD' }, { status: 400 });

  try {
    await assertReportAccess(businessId, 'advanced');
    await authorize(userId, 'report.inventory', 'read', { businessId, resource: { business_id: businessId } });
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  try {
    const report = await buildFifoLotReport(businessId, { itemId, asOf });
    return NextResponse.json({ report });
  } catch (error: any) {
    console.error('Error building FIFO lot report:', error);
    return NextResponse.json({ error: 'Failed to build FIFO lot report', details: error?.message }, { status: 500 });
  }
}
