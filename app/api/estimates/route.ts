import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';

/**
 * GET /api/estimates
 * Fetch all proforma invoices (estimates/quotations) for a business
 * Now fetches from invoices table where document_type = 'proforma_invoice'
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const status = searchParams.get('status');

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

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'invoices', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] | null = null;
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // If error, return empty result to be safe
      return NextResponse.json({ 
        estimates: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        }
      });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    // Check if estimate_status column exists (from migration 139)
    let hasEstimateStatus = false;
    try {
      const colCheck = await db.queryRows(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'invoices' 
        AND column_name = 'estimate_status'
        LIMIT 1
      `);
      hasEstimateStatus = colCheck.length > 0;
    } catch (err) {
      // Column doesn't exist yet, use default
      hasEstimateStatus = false;
    }

    // Query proforma invoices from invoices table
    // Map invoice fields to estimate fields for compatibility
    let query = `
      SELECT 
        i.id,
        i.customer_id,
        c.name as customer_name,
        i.invoice_number as estimate_number,
        i.invoice_date as estimate_date,
        i.expiry_date,
        COALESCE(i.estimate_status, 'draft') as status,
        i.grand_total,
        NULL as converted_invoice_id,
        i.created_at,
        i.updated_at
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.business_id = $1
        AND i.document_type = 'proforma_invoice'
    `;

    const params: any[] = [businessId];
    let paramIndex = 2;

    // Filter by user's accessible branches
    if (accessibleBranchIds !== null) {
      if (accessibleBranchIds.length === 0) {
        // User has no branch access - return empty result
        return NextResponse.json({ 
          estimates: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0
          }
        });
      }
      query += ` AND i.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    if (status) {
      if (hasEstimateStatus) {
        query += ` AND COALESCE(i.estimate_status, 'draft') = $${paramIndex}`;
      } else {
        // Fallback: use invoice status if estimate_status doesn't exist
        query += ` AND i.status = $${paramIndex}`;
      }
      params.push(status);
      paramIndex++;
    }

    // Get total count
    const countParams = params.slice(0, params.length);
    const countSql = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
    const countResult = await db.queryOne<{ total: number }>(countSql, countParams);
    const total = countResult?.total || 0;

    query += ` ORDER BY i.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const estimates = await db.queryRows(query, params);

    return NextResponse.json({ 
      estimates,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching estimates:', error);
    return NextResponse.json(
      { error: 'Failed to fetch estimates', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/estimates
 * Create a new estimate
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      customer_id,
      estimate_number,
      estimate_date,
      expiry_date,
      items,
      subtotal,
      discount_total,
      tax_total,
      round_off,
      grand_total,
      additional_charges,
      additional_charges_label,
      notes,
      terms,
      created_by,
    } = body;

    if (!business_id || !customer_id || !estimate_number || !estimate_date || !items) {
      return NextResponse.json(
        { error: 'business_id, customer_id, estimate_number, estimate_date, and items are required' },
        { status: 400 }
      );
    }

    const actorUserId = resolveCreatedByUserId(request, body) ?? created_by;
    if (!actorUserId) {
      return NextResponse.json({ error: 'created_by is required' }, { status: 400 });
    }
    try {
      await enforceAccess({
        businessId: business_id,
        userId: actorUserId,
        feature: FeatureKeys.ESTIMATES_QUOTATIONS,
        limitType: 'estimates',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    // Create estimate
    const estimate = await db.queryOne(`
      INSERT INTO estimates (
        business_id, customer_id, estimate_number, estimate_date, expiry_date,
        subtotal, discount_total, tax_total, round_off, grand_total,
        additional_charges, additional_charges_label, notes, terms, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `, [
      business_id, customer_id, estimate_number, estimate_date, expiry_date,
      subtotal, discount_total, tax_total, round_off, grand_total,
      additional_charges, additional_charges_label, notes, terms, created_by
    ]);

    // Create estimate items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await db.query(`
        INSERT INTO estimate_items (
          estimate_id, item_id, description, qty, unit, unit_price,
          discount, tax_rate, tax_amount, line_total, sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        estimate.id, item.item_id, item.description, item.qty, item.unit, item.unit_price,
        item.discount, item.tax_rate, item.tax_amount, item.line_total, i
      ]);
    }

    return NextResponse.json({ estimate }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating estimate:', error);
    return NextResponse.json(
      { error: 'Failed to create estimate', details: error.message },
      { status: 500 }
    );
  }
}

