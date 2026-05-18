import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/warehouses
 * Fetch all warehouses for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const branchId = searchParams.get('branch_id'); // Optional: filter by branch

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (PBAC will check warehouse access, business ownership, active status)
    try {
      await authorize(userId, 'warehouse', 'read', {
        businessId,
        warehouseId: undefined, // Read all warehouses user has access to
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let query: string;
    const params: any[] = [businessId];

    // If branchId is provided (and not 'ALL'), filter to only show warehouses linked to that branch
    // Include is_primary flag from branch_warehouses
    if (branchId && branchId !== 'ALL') {
      query = `
        SELECT 
          w.*,
          b.name as branch_name,
          b.branch_code,
          bw.is_primary,
          bw.branch_id as linked_branch_id
        FROM warehouses w
        LEFT JOIN branches b ON w.branch_id = b.id
        INNER JOIN branch_warehouses bw ON bw.warehouse_id = w.id AND bw.branch_id = $2
        WHERE w.business_id = $1
        ORDER BY bw.is_primary DESC NULLS LAST, w.name ASC
      `;
      params.push(branchId);
    } else {
      // No branch_id: return all warehouses WITHOUT branch_warehouses join
      // (avoids duplicate rows for warehouses linked to multiple branches)
      query = `
        SELECT 
          w.*,
          b.name as branch_name,
          b.branch_code
        FROM warehouses w
        LEFT JOIN branches b ON w.branch_id = b.id
        WHERE w.business_id = $1
        ORDER BY w.name ASC
      `;
    }

    const warehouses = await db.queryRows(query, params);

    return NextResponse.json({ warehouses });
  } catch (error: any) {
    console.error('Error fetching warehouses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch warehouses', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/warehouses
 * Create a new warehouse (inventory storage entity)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      branch_id,
      name,
      warehouse_code,
      address_line1,
      address_line2,
      city,
      state,
      pincode,
      country,
      warehouse_type,
    } = body;

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    const created_by = body.created_by || getUserIdFromRequest(request, body); // Support both field names
    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission (PBAC will check branch access, business ownership)
    try {
      await authorize(created_by, 'warehouse', 'create', {
        businessId: business_id,
        branchId: branch_id || undefined,
        warehouseId: undefined, // Creating new warehouse
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // VALIDATION: Check for duplicate warehouse name within the same business
    if (name) {
      const duplicateNameCheck = await db.queryOne(`
        SELECT id, name FROM warehouses 
        WHERE business_id = $1 AND LOWER(TRIM(name)) = LOWER(TRIM($2))
        LIMIT 1
      `, [business_id, name]);

      if (duplicateNameCheck) {
        return NextResponse.json(
          { error: `A warehouse with the name "${name}" already exists. Please use a different name.` },
          { status: 400 }
        );
      }
    }

    // VALIDATION: Check for duplicate warehouse code within the same business (if code provided)
    if (warehouse_code) {
      const duplicateCodeCheck = await db.queryOne(`
        SELECT id, warehouse_code FROM warehouses 
        WHERE business_id = $1 AND LOWER(TRIM(warehouse_code)) = LOWER(TRIM($2))
        LIMIT 1
      `, [business_id, warehouse_code]);

      if (duplicateCodeCheck) {
        return NextResponse.json(
          { error: `A warehouse with the code "${warehouse_code}" already exists. Please use a different code.` },
          { status: 400 }
        );
      }
    }

    const warehouse = await db.queryOne(`
      INSERT INTO warehouses (
        business_id, branch_id, name, warehouse_code, address_line1, address_line2,
        city, state, pincode, country, warehouse_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      business_id, branch_id || null, name, warehouse_code, address_line1, address_line2,
      city, state, pincode, country || 'India', warehouse_type || 'physical'
    ]);

    // If branch_id provided, create mapping
    if (branch_id) {
      await db.query(`
        INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary)
        VALUES ($1, $2, true)
        ON CONFLICT (branch_id, warehouse_id) DO NOTHING
      `, [branch_id, warehouse.id]);
    }

    return NextResponse.json({ warehouse }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to create warehouse', details: error.message },
      { status: 500 }
    );
  }
}
