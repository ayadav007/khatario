import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { foreignBranchIds, warehouseBelongsToBusiness } from '@/lib/warehouse-ownership';

export const dynamic = 'force-dynamic';

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

    // The warehouse itself must belong to this business (authorize skips this for owners).
    if (!(await warehouseBelongsToBusiness(warehouseId, businessId))) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
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
      INNER JOIN branches b ON b.id = bw.branch_id
      WHERE bw.warehouse_id = $1 AND b.business_id = $2
    `, [warehouseId, businessId]);

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

    // The warehouse and every branch named in the body must belong to this business.
    if (!(await warehouseBelongsToBusiness(warehouseId, business_id))) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }
    const requestedBranchIds: string[] = branch_ids.filter(
      (id: unknown): id is string => typeof id === 'string' && id.length > 0
    );
    if (primary_branch_id && !requestedBranchIds.includes(primary_branch_id)) {
      return NextResponse.json(
        { error: 'primary_branch_id must be one of branch_ids' },
        { status: 400 }
      );
    }
    const foreign = await foreignBranchIds(requestedBranchIds, business_id);
    if (foreign.length > 0) {
      return NextResponse.json(
        { error: 'One or more branches do not belong to this business' },
        { status: 400 }
      );
    }

    // Start transaction
    const pool = await import('@/lib/db').then(m => m.getPool());
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Delete all existing links for this business's warehouse
      await client.query(`
        DELETE FROM branch_warehouses bw
        USING warehouses w
        WHERE bw.warehouse_id = w.id
          AND w.id = $1 AND w.business_id = $2
      `, [warehouseId, business_id]);

      // Insert new links; the join re-asserts that branch and warehouse share this business
      for (const branchId of requestedBranchIds) {
        await client.query(`
          INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary)
          SELECT b.id, w.id, $3
          FROM branches b
          JOIN warehouses w ON w.business_id = b.business_id
          WHERE b.id = $1 AND w.id = $2 AND b.business_id = $4
          ON CONFLICT (branch_id, warehouse_id) DO UPDATE SET
            is_primary = EXCLUDED.is_primary
        `, [
          branchId,
          warehouseId,
          branchId === primary_branch_id,
          business_id,
        ]);
      }

      // Update warehouse.branch_id to match primary branch (NULL when none)
      await client.query(`
        UPDATE warehouses
        SET branch_id = $1
        WHERE id = $2 AND business_id = $3
      `, [primary_branch_id || null, warehouseId, business_id]);

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
