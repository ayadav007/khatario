import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/**
 * POST /api/suppliers/hub/mute
 * Body: { supplier_id, muted } — the buyer turns a connected supplier's launch notifications
 * off or on. Their collections still show in New arrivals.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'suppliers', 'update', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    const res = await db.query(
      `UPDATE suppliers SET mute_launches = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND linked_business_id IS NOT NULL AND deleted_at IS NULL`,
      [body.supplier_id, auth.businessId, body.muted === true]
    );
    if (!res.rowCount) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    return NextResponse.json({ ok: true, muted: body.muted === true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('hub mute POST', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
