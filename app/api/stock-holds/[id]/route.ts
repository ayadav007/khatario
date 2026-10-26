import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { settleHold } from '@/lib/stock-custody/holds';
import { authorizeStockCount } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';
import type { ReasonCode } from '@/lib/inventory-adjustment-service';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WRITE_OFF: ReasonCode[] = ['DAMAGE', 'EXPIRED', 'WRITE_DOWN', 'THEFT'];

/** POST /api/stock-holds/[id] — { date, release?, write_off?, reason?, notes? } */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const businessId = UUID.test(params.id) ? getSessionScopedBusinessId(request) : null;
  const hold = businessId
    ? await queryOne<{ warehouse_id: string | null }>(`SELECT warehouse_id FROM stock_holds WHERE id = $1 AND business_id = $2`, [params.id, businessId])
    : null;
  const auth = await authorizeStockCount(request, 'adjust_quantity', { warehouseId: hold?.warehouse_id, adjustmentDate: body.date });
  if (!auth.ok) return auth.response;
  const reason = WRITE_OFF.includes(body.reason) ? (body.reason as ReasonCode) : 'DAMAGE';
  return inStockTransaction(
    async (client) => settleHold(client, auth.businessId, params.id, { date: String(body.date || ''), release: body.release, writeOff: body.write_off, reason, notes: body.notes }, auth.userId),
    'Failed to update held stock'
  );
}
