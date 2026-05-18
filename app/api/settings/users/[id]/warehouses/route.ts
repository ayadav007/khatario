import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/settings/users/[id]/warehouses
 * Get warehouse access for a specific user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // Admin user making the request

    if (!businessId || !userId) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check if admin has permission to view user warehouse access
    try {
      await authorize(userId, 'settings', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const targetUserId = params.id;

    // Get all warehouses for the business
    const allWarehouses = await queryRows(`
      SELECT 
        w.id,
        w.name,
        w.warehouse_code,
        w.branch_id,
        b.name as branch_name,
        w.is_active
      FROM warehouses w
      LEFT JOIN branches b ON w.branch_id = b.id
      WHERE w.business_id = $1
      ORDER BY w.name ASC
    `, [businessId]);

    // Get user's explicit warehouse access
    const userWarehouses = await queryRows(`
      SELECT 
        uw.warehouse_id,
        uw.can_view,
        uw.can_edit,
        uw.can_create_transactions
      FROM user_warehouses uw
      WHERE uw.user_id = $1
    `, [targetUserId]);

    // Create a map of user's warehouse access
    const accessMap = new Map(
      userWarehouses.map((uw: any) => [
        uw.warehouse_id,
        {
          can_view: uw.can_view,
          can_edit: uw.can_edit,
          can_create_transactions: uw.can_create_transactions,
        }
      ])
    );

    // Merge with all warehouses
    const warehousesWithAccess = allWarehouses.map((wh: any) => ({
      id: wh.id,
      name: wh.name,
      warehouse_code: wh.warehouse_code,
      branch_id: wh.branch_id,
      branch_name: wh.branch_name,
      is_active: wh.is_active,
      access: accessMap.get(wh.id) || null, // null means no explicit access
    }));

    return NextResponse.json({ warehouses: warehousesWithAccess });
  } catch (error: any) {
    console.error('Error fetching user warehouse access:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user warehouse access', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/users/[id]/warehouses
 * Update warehouse access for a specific user
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { business_id, warehouses } = body;
    const user_id = getUserIdFromRequest(request, body);

    if (!business_id || !user_id) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(warehouses)) {
      return NextResponse.json(
        { error: 'warehouses must be an array' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check if admin has permission to modify user warehouse access
    try {
      await authorize(user_id, 'settings', 'update', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const targetUserId = params.id;

    // Start transaction
    const pool = await import('@/lib/db').then(m => m.getPool());
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Delete all existing warehouse access for this user
      await client.query(`
        DELETE FROM user_warehouses
        WHERE user_id = $1
      `, [targetUserId]);

      // Insert new warehouse access
      for (const wh of warehouses) {
        if (wh.warehouse_id && (wh.can_view || wh.can_edit || wh.can_create_transactions)) {
          await client.query(`
            INSERT INTO user_warehouses (
              user_id, warehouse_id, can_view, can_edit, can_create_transactions
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, warehouse_id) DO UPDATE SET
              can_view = EXCLUDED.can_view,
              can_edit = EXCLUDED.can_edit,
              can_create_transactions = EXCLUDED.can_create_transactions,
              updated_at = CURRENT_TIMESTAMP
          `, [
            targetUserId,
            wh.warehouse_id,
            wh.can_view || false,
            wh.can_edit || false,
            wh.can_create_transactions || false,
          ]);
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({ success: true });
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error updating user warehouse access:', error);
    return NextResponse.json(
      { error: 'Failed to update user warehouse access', details: error.message },
      { status: 500 }
    );
  }
}
