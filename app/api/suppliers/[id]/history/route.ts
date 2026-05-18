import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { Supplier } from '@/types/database';

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
 * GET /api/suppliers/[id]/history
 * Activity log for this supplier (module = suppliers).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const supplier = await queryOne<Pick<Supplier, 'id' | 'business_id'>>(
      'SELECT id, business_id FROM suppliers WHERE id = $1 AND deleted_at IS NULL',
      [supplierId]
    );

    if (!supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    }

    try {
      await authorize(userId, 'purchases', 'read', { businessId: supplier.business_id });
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
        AND al.module = 'suppliers'
        AND al.entity_id = $2
      ORDER BY al.created_at DESC
      LIMIT $3
      `,
      [supplier.business_id, supplierId, limit]
    );

    return NextResponse.json({ history: rows });
  } catch (error: any) {
    console.error('Error fetching supplier history', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
