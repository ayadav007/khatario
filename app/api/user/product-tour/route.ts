import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';
import { query } from '@/lib/db';

/**
 * PATCH /api/user/product-tour
 * Marks the product tour as completed or dismissed (stops auto-show after first login).
 */
export async function PATCH(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body?.action as string | undefined;
    if (action !== 'complete' && action !== 'dismiss') {
      return NextResponse.json(
        { error: 'Invalid body', expected: { action: ['complete', 'dismiss'] } },
        { status: 400 }
      );
    }

    await query(
      `UPDATE users
       SET product_tour_completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    return NextResponse.json({ ok: true, product_tour_completed_at: new Date().toISOString() });
  } catch (e: any) {
    console.error('[PATCH /api/user/product-tour]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
