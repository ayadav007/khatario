import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listClaims, lodgeClaim } from '@/lib/stock-custody/insurance-claims';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** GET /api/insurance-claims — claims for stock lost or damaged. */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ claims: await listClaims(getPool(), auth.businessId) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load insurance claims');
  }
}

/**
 * POST /api/insurance-claims — { loss_date, cause, insurer, policy_number?, fir_number?, fir_date?,
 *   surveyor?, claimed_amount, adjustment_ids?, branch_id?, notes? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'adjust_value', { adjustmentDate: body.loss_date });
  if (!auth.ok) return auth.response;
  return inStockTransaction(
    async (client) => ({
      id: await lodgeClaim(
        client,
        auth.businessId,
        {
          lossDate: String(body.loss_date || ''),
          cause: body.cause,
          insurer: body.insurer,
          policyNumber: body.policy_number,
          firNumber: body.fir_number,
          firDate: body.fir_date || null,
          surveyor: body.surveyor,
          claimedAmount: Number(body.claimed_amount),
          adjustmentIds: Array.isArray(body.adjustment_ids) ? body.adjustment_ids : [],
          branchId: body.branch_id || null,
          notes: body.notes,
        },
        auth.userId
      ),
    }),
    'Failed to lodge the claim',
    201
  );
}
