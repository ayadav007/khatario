import { NextRequest } from 'next/server';
import { returnOthersGoods } from '@/lib/stock-custody/inward-custody';
import { authorizeStockCount } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** PATCH /api/inward-custody/[id] — { qty, date }: goods handed back to their owner. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  return inStockTransaction(
    async (client) => returnOthersGoods(client, auth.businessId, params.id, { qty: Number(body.qty), date: String(body.date || '') }),
    "Failed to return others' goods"
  );
}
