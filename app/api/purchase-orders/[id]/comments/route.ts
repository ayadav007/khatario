import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
/**
 * POST /api/purchase-orders/[id]/comments
 * Add a user comment on a purchase order.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const purchaseOrderId = params.id;
    const businessId = getSessionScopedBusinessId(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const body = await request.json();
    const commentText = typeof body.comment_text === 'string' ? body.comment_text.trim() : '';
    if (!commentText) {
      return NextResponse.json({ error: 'comment_text is required' }, { status: 400 });
    }

    const po = await queryOne<{ id: string; business_id: string; order_number: string }>(
      'SELECT id, business_id, order_number FROM purchase_orders WHERE id = $1 AND business_id = $2',
      [purchaseOrderId, businessId]
    );
    if (!po) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 });
    }

    const comment = await queryOne<{
      id: string;
      comment_text: string;
      created_at: string;
      user_name: string | null;
    }>(
      `
      INSERT INTO entity_comments (business_id, entity_type, entity_id, comment_text, user_id)
      VALUES ($1, 'purchase_order', $2, $3, $4)
      RETURNING id, comment_text, created_at,
        (SELECT name FROM users WHERE id = $4) AS user_name
      `,
      [businessId, purchaseOrderId, commentText, userId || null]
    );

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error adding purchase order comment:', error);
    const msg = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
