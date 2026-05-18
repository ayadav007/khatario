import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { Supplier } from '@/types/database';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/suppliers
 * Fetch all suppliers for a business
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const search = searchParams.get('search') || '';
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const updatedAfter = searchParams.get('updated_after');

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

    // AUTHORIZATION: Check read permission (suppliers are part of purchases module)
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // NOTE: Suppliers are business-level entities (not branch-specific)
    // They should be visible across all branches of the business
    // The query filters only by business_id and is_active - no branch filtering
    // This ensures all suppliers for a business are visible regardless of which branch the user is in
    
    // Debug: Log total suppliers for this business (including inactive ones for debugging)
    const totalSuppliersDebug = await db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM suppliers WHERE business_id = $1 AND deleted_at IS NULL`,
      [businessId]
    );
    const activeSuppliersDebug = await db.queryOne<{ total: number }>(
      `SELECT COUNT(*) as total FROM suppliers WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true`,
      [businessId]
    );
    console.log(`[Suppliers API] Business ${businessId}: Total suppliers: ${totalSuppliersDebug?.total || 0}, Active: ${activeSuppliersDebug?.total || 0}`);
    
    let sql = `
      SELECT 
        id, business_id, name, phone, email, address,
        city, state, state_code, pincode, gstin,
        opening_balance, opening_balance_type,
        is_active, created_at, updated_at,
        linked_business_id, approval_status, allow_low_stock_access
      FROM suppliers
      -- Soft delete: exclude records where deleted_at is set
      WHERE business_id = $1 AND deleted_at IS NULL AND is_active = true
    `;
    const params: any[] = [businessId];

    // Add search filter
    if (search) {
      sql += ` AND (name ILIKE $${params.length + 1} OR phone ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1})`;
      params.push(`%${search}%`);
    }

    if (updatedAfter) {
      sql += ` AND suppliers.updated_at >= $${params.length + 1}::timestamptz`;
      params.push(updatedAfter);
    }

    // Get total count for pagination
    const countParams = params.slice(0, params.length);
    const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await db.queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    sql += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const suppliers = await db.queryRows<Supplier>(sql, params);
    
    // Debug: Log what was returned
    console.log(`[Suppliers API] Business ${businessId}: Returning ${suppliers.length} suppliers (page ${page}, limit ${limit}, total: ${total})`);

    return NextResponse.json({ 
      suppliers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching suppliers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch suppliers', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suppliers
 * Create a new supplier (optionally link to a business account)
 */
export async function POST(request: NextRequest) {
  console.log('[SupplierAPI] POST /api/suppliers called');
  try {
    const body = await request.json();
    console.log('[SupplierAPI] Request body:', JSON.stringify(body, null, 0).slice(0, 500));
    const business_id = getBusinessIdFromRequest(request, body);
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
      opening_balance = 0,
      opening_balance_type = 'credit',
      linked_business_id,
      allow_low_stock_access = false,
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);
    console.log('[SupplierAPI] business_id:', business_id, 'name:', name, 'createdByUserId:', createdByUserId);

    if (!business_id || !name) {
      return NextResponse.json(
        { error: 'business_id and name are required' },
        { status: 400 }
      );
    }

    if (gstin && typeof gstin === 'string') {
      const trimmedGstin = gstin.trim();
      if (trimmedGstin.length !== 15) {
        return NextResponse.json(
          { error: `Invalid GSTIN "${trimmedGstin}" — must be exactly 15 characters (got ${trimmedGstin.length}). Please correct and try again.` },
          { status: 400 }
        );
      }
      if (!/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z0-9]{2}$/.test(trimmedGstin.toUpperCase())) {
        return NextResponse.json(
          { error: `Invalid GSTIN format "${trimmedGstin}". Expected format: 22AAAAA0000A1Z5` },
          { status: 400 }
        );
      }
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (suppliers are part of purchases module)
    try {
      await authorize(createdByUserId, 'purchases', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: createdByUserId,
        feature: FeatureKeys.SUPPLIER_MANAGEMENT,
        limitType: 'suppliers',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
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

    // Auto-approve when linked to business (remove approval requirement)
    const approvalStatus = linked_business_id ? 'approved' : 'none';
    const approvedAt = linked_business_id ? new Date() : null;

    // Validate: allow_low_stock_access can only be true if linked to business
    const finalAllowLowStockAccess = linked_business_id ? (allow_low_stock_access === true) : false;

    const phoneNorm = normalizePhoneOrNull(phone);

    const supplier = await db.queryOne<Supplier>(`
      INSERT INTO suppliers (
        business_id, name, phone, email, address,
        city, state, state_code, pincode, gstin,
        opening_balance, opening_balance_type,
        linked_business_id, requested_by_business_id, approval_status,
        approved_at, allow_low_stock_access
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING *
    `, [
      business_id, name, phoneNorm, email, address,
      city, state, finalStateCode || null, pincode, gstin,
      opening_balance, opening_balance_type,
      linked_business_id || null,
      linked_business_id ? business_id : null, // Set requester if linking
      approvalStatus,
      approvedAt,
      finalAllowLowStockAccess
    ]);

    if (!supplier) {
      return NextResponse.json(
        { error: 'Failed to create supplier' },
        { status: 500 }
      );
    }

    // PHASE 2: Post opening balance to ledger (if opening_balance > 0)
    if (opening_balance > 0) {
      try {
        const { postOpeningBalanceLedgerEntry } = await import('@/lib/ledger-utils');
        await postOpeningBalanceLedgerEntry({
          businessId: business_id,
          entityType: 'supplier',
          entityId: supplier.id,
          entityName: name,
          openingBalance: opening_balance,
          openingBalanceType: opening_balance_type,
        });
      } catch (ledgerError: any) {
        // Log error but don't fail supplier creation
        // Opening balance is stored in supplier record, ledger entry is supplementary
        console.error('Error posting opening balance ledger entry for supplier:', ledgerError);
      }
    }

    // If linking to a business account, send informational notification
    if (linked_business_id) {
      const requesterBusiness = await db.queryOne(
        `SELECT name FROM businesses WHERE id = $1`,
        [business_id]
      );

      const notificationType = finalAllowLowStockAccess 
        ? 'supplier_access_granted' 
        : 'supplier_approved';
      
      const notificationTitle = finalAllowLowStockAccess
        ? '✓ Low Stock Access Granted'
        : '🤝 Supplier Relationship Established';
      
      const notificationMessage = finalAllowLowStockAccess
        ? `${requesterBusiness?.name || 'A business'} has granted you access to view their low stock alerts. You can now monitor their inventory levels.`
        : `${requesterBusiness?.name || 'A business'} has added you as their supplier. Relationship established successfully.`;

      await db.query(`
        INSERT INTO notifications (
          business_id, type, title, message,
          reference_type, reference_id, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        linked_business_id,
        notificationType,
        notificationTitle,
        notificationMessage,
        'supplier',
        supplier.id,
        new Date()
      ]);
    }

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id,
      user_id: createdByUserId,
      action_type: 'create',
      module: 'suppliers',
      entity_id: supplier.id,
      entity_type: 'supplier',
      description: `Created supplier ${name}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        name,
        gstin: gstin || null,
        linked_business_id: linked_business_id || null,
      },
    });

    return NextResponse.json({ supplier }, { status: 201 });
  } catch (error: any) {
    console.error('[SupplierAPI] ERROR creating supplier:', error?.message);
    console.error('[SupplierAPI] Stack:', error?.stack);
    return NextResponse.json(
      { error: 'Failed to create supplier', details: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

