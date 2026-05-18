import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';

export interface ActivityLogRow {
  id: string;
  action_type: string;
  module: string;
  entity_id: string | null;
  entity_type: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

/**
 * GET /api/purchases/[id]/history
 * Activity log for this purchase (module = purchases).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const purchaseId = params.id;
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getBusinessIdFromRequest(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const purchase = await queryOne<{ id: string; business_id: string; branch_id: string | null }>(
      'SELECT id, business_id, branch_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [purchaseId, businessScope]
    );

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'purchases', 'read', {
        businessId: purchase.business_id,
        branchId: purchase.branch_id ?? undefined,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get('limit') ?? '100');
    const limit = Math.min(Math.max(limitParam, 1), 500);

    const rows = await queryRows<ActivityLogRow>(
      `
      SELECT
        al.id,
        al.action_type,
        al.module,
        al.entity_id,
        al.entity_type,
        al.description,
        al.metadata,
        al.created_at,
        u.name AS user_name,
        u.email AS user_email
      FROM activity_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.business_id = $1
        AND al.module = 'purchases'
        AND al.entity_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
      `,
      [purchase.business_id, purchaseId, limit]
    );

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error('Error fetching purchase history', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
