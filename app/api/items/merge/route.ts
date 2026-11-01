import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { mergeItems, previewItemMerge } from '@/lib/items/item-merge';
import { stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

export const dynamic = 'force-dynamic';

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

/** GET /api/items/merge?source_item_id=&target_item_id= — what would move, and anything blocking it. */
export async function GET(request: NextRequest) {
  const auth = await guard(request, 'read');
  if (!auth.ok) return auth.response;
  const sp = request.nextUrl.searchParams;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const preview = await previewItemMerge(client, auth.businessId, sp.get('source_item_id') || '', sp.get('target_item_id') || '');
    await client.query('ROLLBACK');
    return NextResponse.json(preview);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, 'Failed to preview the merge');
  } finally {
    client.release();
  }
}

/** POST /api/items/merge — { source_item_id, target_item_id }: fold the duplicate into the item that stays. */
export async function POST(request: NextRequest) {
  const auth = await guard(request, 'update');
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await mergeItems(client, auth.businessId, String(body.source_item_id || ''), String(body.target_item_id || ''), auth.userId);
    await client.query('COMMIT');
    return NextResponse.json(result);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, 'Failed to merge the items');
  } finally {
    client.release();
  }
}
