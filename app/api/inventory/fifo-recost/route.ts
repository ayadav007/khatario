import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getValuationMethod } from '@/lib/inventory/fifo-costing';
import { getRecostFrom, recostItems } from '@/lib/inventory/fifo-recost';

export const dynamic = 'force-dynamic';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/inventory/fifo-recost
 * Body: { dry_run?: boolean (default true), from_date?: 'YYYY-MM-DD', item_ids?: string[] }
 * Re-runs FIFO and lists (dry run) or posts the cost corrections for invoices, credit notes,
 * loss adjustments and inter-branch receipts. `from_date` defaults to the business cut-over;
 * an earlier date restates older vouchers. Locked periods are never changed.
 */
export async function POST(request: NextRequest) {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dry_run !== false;
  const fromDate: string | null = body?.from_date ?? null;
  const itemIds: string[] | null = Array.isArray(body?.item_ids) ? body.item_ids : null;
  if (fromDate !== null && !DATE.test(String(fromDate))) {
    return NextResponse.json({ error: 'from_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (itemIds && !itemIds.every((id) => typeof id === 'string' && UUID.test(id))) {
    return NextResponse.json({ error: 'item_ids must be UUIDs' }, { status: 400 });
  }

  try {
    if (dryRun) {
      await authorize(userId, 'report.inventory', 'read', { businessId, resource: { business_id: businessId } });
    } else {
      await authorize(userId, 'settings', 'update', { businessId });
    }
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if ((await getValuationMethod(client, businessId)) !== 'fifo') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Stock valuation method is not FIFO for this business', code: 'NOT_FIFO' },
        { status: 400 }
      );
    }
    const ids =
      itemIds ??
      (
        await client.query<{ id: string }>(
          `SELECT id FROM items WHERE business_id = $1 AND item_type = 'goods' AND NOT COALESCE(is_bundle, false)`,
          [businessId]
        )
      ).rows.map((r) => r.id);
    const from = fromDate ?? (await getRecostFrom(client, businessId)) ?? null;
    const report = await recostItems(client, businessId, ids, { fromDate: from, dryRun });
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return NextResponse.json({ from_date: from, report });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error recosting FIFO:', error);
    return NextResponse.json({ error: 'Failed to recalculate FIFO cost', details: error?.message }, { status: 500 });
  } finally {
    client.release();
  }
}
