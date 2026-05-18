import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';

/**
 * GET /api/user-warehouses
 * Get warehouse access for a user
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      );
    }

    const { getUserWarehouses } = await import('@/lib/warehouse-access');
    const warehouses = await getUserWarehouses(userId);

    return NextResponse.json({ warehouses });
  } catch (error: any) {
    console.error('Error fetching user warehouses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user warehouses', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user-warehouses
 * Grant warehouse access to a user
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const body = await request.json();
    const {
      user_id,
      warehouse_id,
      can_view = true,
      can_edit = false,
      can_create_transactions = false,
    } = body;

    if (!user_id || !warehouse_id) {
      client.release();
      return NextResponse.json(
        { error: 'user_id and warehouse_id are required' },
        { status: 400 }
      );
    }

    // Validate user and warehouse exist
    const userCheck = await client.query(
      'SELECT id, business_id FROM users WHERE id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      client.release();
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const warehouseCheck = await client.query(
      'SELECT id, business_id FROM warehouses WHERE id = $1',
      [warehouse_id]
    );

    if (warehouseCheck.rows.length === 0) {
      client.release();
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      );
    }

    // Validate user and warehouse belong to same business
    if (userCheck.rows[0].business_id !== warehouseCheck.rows[0].business_id) {
      client.release();
      return NextResponse.json(
        { error: 'User and warehouse must belong to the same business' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    // Insert or update warehouse access
    const result = await client.query(`
      INSERT INTO user_warehouses (user_id, warehouse_id, can_view, can_edit, can_create_transactions)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, warehouse_id)
      DO UPDATE SET
        can_view = EXCLUDED.can_view,
        can_edit = EXCLUDED.can_edit,
        can_create_transactions = EXCLUDED.can_create_transactions,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [user_id, warehouse_id, can_view, can_edit, can_create_transactions]);

    await client.query('COMMIT');
    client.release();

    return NextResponse.json({ access: result.rows[0] });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error granting warehouse access:', error);
    return NextResponse.json(
      { error: 'Failed to grant warehouse access', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user-warehouses
 * Revoke warehouse access from a user
 */
export async function DELETE(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const { searchParams } = new URL(request.url);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');

    if (!userId || !warehouseId) {
      client.release();
      return NextResponse.json(
        { error: 'user_id and warehouse_id are required' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');

    const result = await client.query(`
      DELETE FROM user_warehouses
      WHERE user_id = $1 AND warehouse_id = $2
      RETURNING *
    `, [userId, warehouseId]);

    await client.query('COMMIT');
    client.release();

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Warehouse access not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ message: 'Warehouse access revoked' });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    console.error('Error revoking warehouse access:', error);
    return NextResponse.json(
      { error: 'Failed to revoke warehouse access', details: error.message },
      { status: 500 }
    );
  }
}
