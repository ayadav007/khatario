import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import {
  CodRemittanceError,
  listOpenCod,
  listRemittances,
  recordRemittance,
  REMITTANCE_SOURCES,
  type RemittanceSource,
} from '@/lib/fulfilment/cod-remittance';
import { listSettlementAccounts } from '@/lib/accounting/settlement-accounts-db';
import { SettlementAccountError } from '@/lib/accounting/settlement-accounts';
import { storeSettlementChoice } from '@/lib/store/store-receipt';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET: delivered COD parcels still waiting for cash, and recent remittances. */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const pool = getPool();
  const [open, remittances, accounts] = await Promise.all([
    listOpenCod(pool, auth.scope.businessId, auth.scope.branchIds),
    listRemittances(pool, auth.scope.businessId),
    listSettlementAccounts(auth.scope.businessId),
  ]);
  const defaultAccount = await storeSettlementChoice(auth.scope.businessId, 'bank').catch(() => null);
  return NextResponse.json({
    open,
    open_total: Math.round(open.reduce((s, p) => s + p.cod_amount, 0) * 100) / 100,
    remittances,
    settlement_accounts: accounts
      .filter((a) => a.kind === 'cash' || a.kind === 'bank')
      .map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind })),
    default_settlement_account_id: defaultAccount?.accountId ?? null,
  });
}

/** POST { source, partner_name?, reference?, remitted_on, received_amount, fulfilment_ids: [], settlement_account_id? } */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = (REMITTANCE_SOURCES as readonly string[]).includes(String(body.source)) ? (body.source as RemittanceSource) : null;
  if (!source) return NextResponse.json({ error: 'Who paid the cash over?' }, { status: 400 });
  const ids = Array.isArray(body.fulfilment_ids)
    ? (body.fulfilment_ids as unknown[]).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    : [];

  // A store order delivered before its bill was posted gets the bill first, outside the remittance lock.
  const unbilled = await getPool().query<{ store_order_id: string }>(
    `SELECT f.store_order_id FROM order_fulfilments f
       JOIN store_orders so ON so.id = f.store_order_id AND so.business_id = f.business_id
      WHERE f.business_id = $1 AND f.id = ANY($2::uuid[]) AND so.invoice_id IS NULL`,
    [auth.scope.businessId, ids],
  );
  if (unbilled.rows.length > 0) {
    const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
    for (const r of unbilled.rows) {
      await createInvoiceForStoreOrder(r.store_order_id, auth.scope.businessId, auth.userId).catch((err) => {
        console.error('[cod remittance invoice]', err);
      });
    }
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await recordRemittance(client, {
      businessId: auth.scope.businessId,
      userId: auth.userId,
      source,
      partnerName: typeof body.partner_name === 'string' ? body.partner_name : null,
      reference: typeof body.reference === 'string' ? body.reference : null,
      remittedOn: String(body.remitted_on ?? ''),
      receivedAmount: Number(body.received_amount),
      fulfilmentIds: ids,
      notes: typeof body.notes === 'string' ? body.notes : null,
      settlementAccountId:
        typeof body.settlement_account_id === 'string' && UUID_RE.test(body.settlement_account_id)
          ? body.settlement_account_id
          : null,
    });
    await client.query('COMMIT');
    return NextResponse.json(out, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof CodRemittanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SettlementAccountError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('[cod remittance]', error);
    return NextResponse.json({ error: 'Could not save the remittance' }, { status: 500 });
  } finally {
    client.release();
  }
}
