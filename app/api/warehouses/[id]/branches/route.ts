import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/warehouses/[id]/branches
 * Get branches linked to a specific warehouse
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    const warehouseId = params.id;

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'warehouse', 'read', {
        businessId,
        warehouseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get all branches for the business
    const allBranches = await queryRows(`
      SELECT 
        b.id,
        b.name,
        b.branch_code,
        b.is_active
      FROM branches b
      WHERE b.business_id = $1
      ORDER BY b.name ASC
    `, [businessId]);

    // Get branches linked to this warehouse
    const linkedBranches = await queryRows(`
      SELECT 
        bw.branch_id,
        bw.is_primary
      FROM branch_warehouses bw
      WHERE bw.warehouse_id = $1
    `, [warehouseId]);

    const linkedBranchIds = new Set(
      linkedBranches.map((lb: any) => lb.branch_id)
    );
    const primaryBranchId = linkedBranches.find((lb: any) => lb.is_primary)?.branch_id;

    // Merge with all branches
    const branchesWithLink = allBranches.map((br: any) => ({
      id: br.id,
      name: br.name,
      branch_code: br.branch_code,
      is_active: br.is_active,
      is_linked: linkedBranchIds.has(br.id),
      is_primary: br.id === primaryBranchId,
    }));

    return NextResponse.json({ branches: branchesWithLink });
  } catch (error: any) {
    console.error('Error fetching warehouse branches:', error);
    return NextResponse.json(
      { error: 'Failed to fetch warehouse branches', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/warehouses/[id]/branches
 * Update branch-warehouse links
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { branch_ids, primary_branch_id } = body;
    const business_id = getBusinessIdFromRequest(request, body);
    const user_id = getUserIdFromRequest(request, body);

    if (!business_id || !user_id) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(branch_ids)) {
      return NextResponse.json(
        { error: 'branch_ids must be an array' },
        { status: 400 }
      );
    }

    const warehouseId = params.id;

    // AUTHORIZATION: Check update permission
    try {
      await authorize(user_id, 'warehouse', 'update', {
        businessId: business_id,
        warehouseId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Start transaction
    const pool = await import('@/lib/db').then(m => m.getPool());
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Delete all existing links
      await client.query(`
        DELETE FROM branch_warehouses
        WHERE warehouse_id = $1
      `, [warehouseId]);

      // Insert new links
      for (const branchId of branch_ids) {
        if (branchId) {
          await client.query(`
            INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary)
            VALUES ($1, $2, $3)
            ON CONFLICT (branch_id, warehouse_id) DO UPDATE SET
              is_primary = EXCLUDED.is_primary
          `, [
            branchId,
            warehouseId,
            branchId === primary_branch_id,
          ]);
        }
      }

      // Update warehouse.branch_id to match primary branch
      if (primary_branch_id) {
        await client.query(`
          UPDATE warehouses
          SET branch_id = $1
          WHERE id = $2
        `, [primary_branch_id, warehouseId]);
      } else {
        // If no primary branch, set to NULL
        await client.query(`
          UPDATE warehouses
          SET branch_id = NULL
          WHERE id = $1
        `, [warehouseId]);
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
    console.error('Error updating warehouse branches:', error);
    return NextResponse.json(
      { error: 'Failed to update warehouse branches', details: error.message },
      { status: 500 }
    );
  }
}
