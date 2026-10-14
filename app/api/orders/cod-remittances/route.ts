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

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET: delivered COD parcels still waiting for cash, and recent remittances. */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const pool = getPool();
  const [open, remittances] = await Promise.all([
    listOpenCod(pool, auth.scope.businessId, auth.scope.branchIds),
    listRemittances(pool, auth.scope.businessId),
  ]);
  return NextResponse.json({
    open,
    open_total: Math.round(open.reduce((s, p) => s + p.cod_amount, 0) * 100) / 100,
    remittances,
  });
}

/** POST { source, partner_name?, reference?, remitted_on, received_amount, fulfilment_ids: [] } */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = (REMITTANCE_SOURCES as readonly string[]).includes(String(body.source)) ? (body.source as RemittanceSource) : null;
  if (!source) return NextResponse.json({ error: 'Who paid the cash over?' }, { status: 400 });
  const ids = Array.isArray(body.fulfilment_ids)
    ? (body.fulfilment_ids as unknown[]).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    : [];

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
    });
    await client.query('COMMIT');
    return NextResponse.json(out, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof CodRemittanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[cod remittance]', error);
    return NextResponse.json({ error: 'Could not save the remittance' }, { status: 500 });
  } finally {
    client.release();
  }
}
