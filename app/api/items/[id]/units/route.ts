import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { listItemUnits, saveItemUnits } from '@/lib/items/item-units';
import { stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

async function guard(request: NextRequest, action: 'read' | 'update') {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return { ok: false as const, response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'items', action, { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false as const, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true as const, userId, businessId };
}

/** GET /api/items/[id]/units — alternate units of the item. */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await guard(request, 'read');
  if (!auth.ok) return auth.response;
  return NextResponse.json({ units: await listItemUnits(getPool(), auth.businessId, [params.id]) });
}

/** PUT /api/items/[id]/units — { units: [{ unit, factor_to_base, barcode? }] } replaces them. */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await guard(request, 'update');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const units = await saveItemUnits(client, auth.businessId, params.id, Array.isArray(body.units) ? body.units : []);
    await client.query('COMMIT');
    return NextResponse.json({ units });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, 'Failed to save the units');
  } finally {
    client.release();
  }
}
