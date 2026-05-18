import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/warehouses/[id]
 * Fetch a single warehouse
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getBusinessIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Fetch warehouse first to get details for authorization
    const warehouse = await db.queryOne(`
      SELECT w.*, b.name as branch_name, b.branch_code
      FROM warehouses w
      LEFT JOIN branches b ON w.branch_id = b.id
      WHERE w.id = $1 AND w.business_id = $2
    `, [params.id, businessId]);

    if (!warehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check read permission (PBAC will check warehouse access, business ownership, active status)
    try {
      await authorize(userId, 'warehouse', 'read', {
        businessId: warehouse.business_id,
        branchId: warehouse.branch_id,
        warehouseId: params.id,
        resource: warehouse,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    return NextResponse.json({ warehouse });
  } catch (error: any) {
    console.error('Error fetching warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to fetch warehouse', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/warehouses/[id]
 * Update a warehouse
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const {
      name,
      warehouse_code,
      branch_id,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      country,
      warehouse_type,
      is_active,
    } = body;

    const updated_by = body.updated_by || getUserIdFromRequest(request, body);
    const businessId = getBusinessIdFromRequest(request, body);

    if (!updated_by) {
      return NextResponse.json(
        { error: 'updated_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch existing warehouse for authorization
    const existingWarehouse = await db.queryOne(`
      SELECT * FROM warehouses WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    if (!existingWarehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (PBAC will check warehouse access, business ownership, active status, branch access)
    try {
      await authorize(updated_by, 'warehouse', 'update', {
        businessId: existingWarehouse.business_id,
        branchId: branch_id || existingWarehouse.branch_id,
        warehouseId: params.id,
        resource: existingWarehouse,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // VALIDATION: Check for duplicate warehouse name within the same business (excluding current warehouse)
    if (name !== undefined && name !== existingWarehouse.name) {
      const duplicateNameCheck = await db.queryOne(`
        SELECT id, name FROM warehouses 
        WHERE business_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2)) AND id != $3
        LIMIT 1
      `, [businessId, name, params.id]);

      if (duplicateNameCheck) {
        return NextResponse.json(
          { error: `A warehouse with the name "${name}" already exists. Please use a different name.` },
          { status: 400 }
        );
      }
    }

    // VALIDATION: Check for duplicate warehouse code within the same business (excluding current warehouse)
    if (warehouse_code !== undefined && warehouse_code !== existingWarehouse.warehouse_code) {
      // Only check if code is provided and different from current
      if (warehouse_code) {
        const duplicateCodeCheck = await db.queryOne(`
          SELECT id, warehouse_code FROM warehouses 
          WHERE business_id = $1 AND LOWER(TRIM(warehouse_code)) = LOWER(TRIM($2)) AND id != $3
          LIMIT 1
        `, [businessId, warehouse_code, params.id]);

        if (duplicateCodeCheck) {
          return NextResponse.json(
            { error: `A warehouse with the code "${warehouse_code}" already exists. Please use a different code.` },
            { status: 400 }
          );
        }
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (warehouse_code !== undefined) {
      updates.push(`warehouse_code = $${paramIndex++}`);
      values.push(warehouse_code);
    }
    if (branch_id !== undefined) {
      updates.push(`branch_id = $${paramIndex++}`);
      values.push(branch_id || null);
    }
    if (address_line1 !== undefined) {
      updates.push(`address_line1 = $${paramIndex++}`);
      values.push(address_line1);
    }
    if (address_line2 !== undefined) {
      updates.push(`address_line2 = $${paramIndex++}`);
      values.push(address_line2);
    }
    if (city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(city);
    }
    if (state !== undefined) {
      updates.push(`state = $${paramIndex++}`);
      values.push(state);
    }
    if (pincode !== undefined) {
      updates.push(`pincode = $${paramIndex++}`);
      values.push(pincode);
    }
    if (country !== undefined) {
      updates.push(`country = $${paramIndex++}`);
      values.push(country);
    }
    if (warehouse_type !== undefined) {
      updates.push(`warehouse_type = $${paramIndex++}`);
      values.push(warehouse_type);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(params.id, businessId);

    const warehouse = await db.queryOne(`
      UPDATE warehouses
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex++} AND business_id = $${paramIndex++}
      RETURNING *
    `, values);

    // Update branch_warehouses mapping if branch_id changed
    if (branch_id !== undefined && branch_id) {
      await db.query(`
        INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary)
        VALUES ($1, $2, true)
        ON CONFLICT (branch_id, warehouse_id) DO NOTHING
      `, [branch_id, params.id]);
    }

    return NextResponse.json({ warehouse });
  } catch (error: any) {
    console.error('Error updating warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to update warehouse', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/warehouses/[id]
 * Delete a warehouse
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getBusinessIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fetch existing warehouse for authorization
    const existingWarehouse = await db.queryOne(`
      SELECT * FROM warehouses WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    if (!existingWarehouse) {
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission (PBAC will check warehouse access, business ownership, active status, branch access)
    try {
      await authorize(userId, 'warehouse', 'delete', {
        businessId: existingWarehouse.business_id,
        branchId: existingWarehouse.branch_id,
        warehouseId: params.id,
        resource: existingWarehouse,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check if warehouse has stock or active transfers (prevent deletion if it does)
    const stockCheck = await db.queryOne(`
      SELECT COUNT(*) as count FROM location_stock
      WHERE location_id = $1 AND current_stock_qty > 0
    `, [params.id]);

    const transferCheck = await db.queryOne(`
      SELECT COUNT(*) as count FROM stock_transfers
      WHERE (from_location_id = $1 OR to_location_id = $1)
      AND status IN ('pending', 'in_transit')
    `, [params.id]);

    if (parseInt(stockCheck?.count || '0') > 0) {
      return NextResponse.json(
        { error: 'Cannot delete warehouse with stock. Please transfer or adjust stock first.' },
        { status: 400 }
      );
    }

    if (parseInt(transferCheck?.count || '0') > 0) {
      return NextResponse.json(
        { error: 'Cannot delete warehouse with active transfers. Please complete or cancel transfers first.' },
        { status: 400 }
      );
    }

    // Delete warehouse (CASCADE will handle related records)
    await db.query(`
      DELETE FROM warehouses
      WHERE id = $1 AND business_id = $2
    `, [params.id, businessId]);

    return NextResponse.json({ success: true, message: 'Warehouse deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to delete warehouse', details: error.message },
      { status: 500 }
    );
  }
}
