import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { loadBrs } from '@/lib/bank/brs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bank/brs?bank_account_id=&as_on_date=YYYY-MM-DD
 * Bank reconciliation statement: books → bank with outstanding items on both sides.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: searchParams.get('business_id'),
    resource: 'settings',
    action: 'read',
  });
  if (!guard.ok) return guard.response;

  const bankAccountId = searchParams.get('bank_account_id');
  if (!bankAccountId) return NextResponse.json({ error: 'bank_account_id is required' }, { status: 400 });
  const asOn = searchParams.get('as_on_date') || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
    return NextResponse.json({ error: 'as_on_date must be YYYY-MM-DD' }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    const brs = await loadBrs(client, { businessId: guard.businessId, bankAccountId, asOnDate: asOn });
    if (!brs.ok) return NextResponse.json({ error: brs.error }, { status: brs.status });
    const { ok: _ok, ...payload } = brs;
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('BRS error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
