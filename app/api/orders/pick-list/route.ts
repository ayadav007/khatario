import { NextRequest, NextResponse } from 'next/server';
import { isHubSource, listOrderHub, loadDispatchSlaHours, type HubSource } from '@/lib/fulfilment/hub';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { buildPickList } from '@/lib/fulfilment/pick-list';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/orders/pick-list  { orders?: [{ source, id }] }
 * Items to pick for the chosen orders; without a selection, every order waiting to be packed.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  let refs: Array<{ source: HubSource; id: string }> = Array.isArray(body.orders)
    ? (body.orders as Record<string, unknown>[])
        .filter((o) => o && isHubSource(o.source) && typeof o.id === 'string' && UUID_RE.test(o.id))
        .map((o) => ({ source: o.source as HubSource, id: String(o.id) }))
    : [];
  if (refs.length === 0) {
    const slaHours = await loadDispatchSlaHours(auth.scope.businessId);
    const list = await listOrderHub(auth.scope, { needs: 'to_pack', page: 1, limit: 100, slaHours });
    refs = list.rows.map((r) => ({ source: r.source_type, id: r.source_id }));
  }
  return NextResponse.json(await buildPickList(auth.scope, refs));
}
