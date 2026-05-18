import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { Customer } from '@/types/database';

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
 * GET /api/customers/[id]/history
 * Activity log for this customer.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const customerId = params.id;
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    const customer = await queryOne<Customer>(
      'SELECT id, business_id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
      [customerId, businessScope]
    );
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'customers', 'read', { businessId: customer.business_id });
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
        AND al.module = 'customers'
        AND al.entity_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
      `,
      [customer.business_id, customerId, limit]
    );

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error('Error fetching customer history', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
