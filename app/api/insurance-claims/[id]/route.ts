import { NextRequest } from 'next/server';
import { updateClaim, type ClaimAction } from '@/lib/stock-custody/insurance-claims';
import { authorizeStockCount } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/insurance-claims/[id]
 *   { action: 'admit', amount, date } | { action: 'settle', amount, date, account_id } | { action: 'reject', date, notes? }
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = (await request.json().catch(() => ({}))) as ClaimAction;
  const auth = await authorizeStockCount(request, 'adjust_value', { adjustmentDate: (body as any).date });
  if (!auth.ok) return auth.response;
  return inStockTransaction(async (client) => {
    await updateClaim(client, auth.businessId, params.id, body);
    return { ok: true };
  }, 'Failed to update the claim');
}
