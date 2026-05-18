import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { Supplier } from '@/types/database';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/suppliers/[id]
 * Fetch a single supplier with transactions
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const supplier = await db.queryOne<Supplier>(`
      SELECT * FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
    `, [supplierId, businessId]);

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check read permission (suppliers are part of purchases module)
    try {
      await authorize(userId, 'purchases', 'read', { businessId: supplier.business_id, resourceId: supplierId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs for filtering transactions
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    const branchFilter = accessibleBranchIds.length > 0
      ? `AND branch_id = ANY($3::uuid[])`
      : '';
    const txnBaseParams = accessibleBranchIds.length > 0
      ? [supplierId, businessId, accessibleBranchIds]
      : [supplierId, businessId];

    // Get purchases for this supplier - scoped to business and filtered by accessible branches
    const purchases = await db.queryRows(`
      SELECT 
        id, bill_number, bill_date, grand_total, paid_amount, status
      FROM purchases
      WHERE supplier_id = $1 AND business_id = $2
        ${branchFilter}
      ORDER BY bill_date DESC
      LIMIT 20
    `, txnBaseParams);

    // Get payments for this supplier
    const payments = await db.queryRows(`
      SELECT 
        id, amount, payment_mode, payment_date, notes
      FROM payments
      WHERE supplier_id = $1 AND business_id = $2
        ${branchFilter}
      ORDER BY payment_date DESC
      LIMIT 20
    `, txnBaseParams);

    const payableResult = await db.queryOne(`
      SELECT 
        COALESCE(SUM(grand_total - paid_amount), 0) as total_payable
      FROM purchases
      WHERE supplier_id = $1 AND business_id = $2
        AND status != 'cancelled'
        ${branchFilter}
    `, txnBaseParams);

    return NextResponse.json({
      supplier,
      purchases,
      payments,
      totalPayable: parseFloat(payableResult?.total_payable || '0'),
    });
  } catch (error: any) {
    console.error('Error fetching supplier:', error);
    return NextResponse.json(
      { error: 'Failed to fetch supplier', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/suppliers/[id]
 * Update a supplier
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }
    const {
      name,
      phone,
      email,
      address,
      city,
      state,
      state_code,
      pincode,
      gstin,
      opening_balance,
      opening_balance_type,
      notes,
      is_active,
      allow_low_stock_access,
      updated_by_user_id, // REQUIRED for authorization
    } = body;

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get supplier first to get business_id and linked_business_id
    const existingSupplier = await db.queryOne<Pick<Supplier, 'business_id' | 'linked_business_id'>>(`
      SELECT business_id, linked_business_id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
    `, [supplierId, business_id]);

    if (!existingSupplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (suppliers are part of purchases module)
    try {
      await authorize(updated_by_user_id, 'purchases', 'update', { businessId: existingSupplier.business_id, resourceId: supplierId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Helper function to get state code if not provided
    const getStateCode = (stateName: string): string => {
      if (!stateName) return '';
      const name = stateName.trim().toLowerCase();
      const map: Record<string, string> = {
        'andhra pradesh': '37', 'karnataka': '29', 'tamil nadu': '33', 'maharashtra': '27',
        'gujarat': '24', 'rajasthan': '08', 'uttar pradesh': '09', 'west bengal': '19',
        'delhi': '07', 'telangana': '36', 'haryana': '06', 'punjab': '03', 'odisha': '21',
        'bihar': '10', 'madhya pradesh': '23', 'assam': '18', 'jharkhand': '20',
        'kerala': '32', 'chhattisgarh': '22', 'uttarakhand': '05', 'himachal pradesh': '02',
        'tripura': '16', 'manipur': '14', 'meghalaya': '17', 'mizoram': '15',
        'nagaland': '13', 'arunachal pradesh': '12', 'goa': '30', 'sikkim': '11',
        'andaman and nicobar islands': '35', 'chandigarh': '04',
        'dadra and nagar haveli and daman and diu': '26', 'jammu and kashmir': '01',
        'ladakh': '38', 'lakshadweep': '31', 'puducherry': '34'
      };
      return map[name] || '';
    };

    // Use provided state_code or calculate from state name
    const finalStateCode = state_code || (state ? getStateCode(state) : null);
    const phoneNorm = phone !== undefined ? normalizePhoneOrNull(phone) : undefined;

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(existingSupplier.business_id, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // PHASE 2: Check if opening balance is being modified and if supplier has transactions
    if (opening_balance !== undefined || opening_balance_type !== undefined) {
      const { supplierHasTransactions } = await import('@/lib/ledger-utils');
      const hasTransactions = await supplierHasTransactions(supplierId);
      
      if (hasTransactions) {
        return NextResponse.json(
          {
            error: 'Opening balance cannot be modified once transactions exist for this supplier',
            code: 'OPENING_BALANCE_LOCKED'
          },
          { status: 400 }
        );
      }
    }

    // Validate: allow_low_stock_access can only be true if linked to business
    let finalAllowLowStockAccess = undefined;
    if (allow_low_stock_access !== undefined) {
      if (allow_low_stock_access === true && !existingSupplier.linked_business_id) {
        return NextResponse.json(
          { error: 'Cannot grant low stock access: supplier must be linked to a business account' },
          { status: 400 }
        );
      }
      finalAllowLowStockAccess = existingSupplier.linked_business_id ? allow_low_stock_access : false;
    }

    const supplier = await db.queryOne<Supplier>(`
      UPDATE suppliers
      SET 
        name = COALESCE($1, name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        address = COALESCE($4, address),
        city = COALESCE($5, city),
        state = COALESCE($6, state),
        state_code = COALESCE($7, state_code),
        pincode = COALESCE($8, pincode),
        gstin = COALESCE($9, gstin),
        opening_balance = COALESCE($10, opening_balance),
        opening_balance_type = COALESCE($11, opening_balance_type),
        notes = COALESCE($12, notes),
        is_active = COALESCE($13, is_active),
        allow_low_stock_access = COALESCE($14, allow_low_stock_access),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $15 AND business_id = $16
      RETURNING *
    `, [
      name, phoneNorm, email, address, city, state, finalStateCode, pincode, gstin,
      opening_balance, opening_balance_type, notes, is_active, finalAllowLowStockAccess, supplierId,
      business_id,
    ]);

    if (!supplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: existingSupplier.business_id,
      user_id: updated_by_user_id,
      action_type: 'update',
      module: 'suppliers',
      entity_id: supplierId,
      entity_type: 'supplier',
      description: `Updated supplier ${supplier.name}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        name: supplier.name,
        is_active: supplier.is_active,
      },
    });

    return NextResponse.json({ supplier });
  } catch (error: any) {
    console.error('Error updating supplier:', error);
    return NextResponse.json(
      { error: 'Failed to update supplier', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suppliers/[id]
 * Soft delete a supplier
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = params.id;
    const userId = getUserIdFromRequest(request);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    const existingSupplier = await db.queryOne<Pick<Supplier, 'business_id'>>(`
      SELECT business_id FROM suppliers WHERE id = $1 AND business_id = $2
    `, [supplierId, businessId]);

    if (!existingSupplier) {
      return NextResponse.json(
        { error: 'Supplier not found' },
        { status: 404 }
      );
    }

    try {
      await authorize(userId, 'purchases', 'delete', {
        businessId: existingSupplier.business_id,
        resourceId: supplierId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(existingSupplier.business_id, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await db.query(`
      UPDATE suppliers
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
    `, [supplierId, businessId]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting supplier:', error);
    return NextResponse.json(
      { error: 'Failed to delete supplier', details: error.message },
      { status: 500 }
    );
  }
}

