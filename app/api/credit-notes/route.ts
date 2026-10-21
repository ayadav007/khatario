import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { FeatureKeys } from '@/lib/featureKeys';
import { getAuthenticatedUserId, getSessionScopedBusinessId, requireStrictSession } from '@/lib/auth-helpers';
import { enforceAccess, enforceAccessErrorResponse, isPrimaryAdminForBusiness } from '@/lib/enforce-access';
import { CreditNoteCreateError, createCreditNoteInTransaction, nextCreditNoteNumber } from '@/lib/credit-notes/create-credit-note';

export const dynamic = 'force-dynamic';

/**
 * GET /api/credit-notes
 * Fetch all credit notes for a business
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;
    const { searchParams } = new URL(request.url);

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'credit_notes', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (searchParams.get('next_number') === '1') {
      return NextResponse.json({ next_credit_note_number: await nextCreditNoteNumber(getPool(), businessId) });
    }

    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const search = searchParams.get('search') || '';

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json({ 
        creditNotes: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0
        }
      });
    }

    const isAdmin = await isPrimaryAdminForBusiness(userId, businessId).catch(() => false);

    const pool = getPool();
    
    // Build query with search
    let whereClause = 'WHERE cn.business_id = $1';
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ 
          creditNotes: [],
          pagination: {
            page: 1,
            limit: 50,
            total: 0,
            totalPages: 0
          }
        });
      }
      whereClause += ` AND cn.branch_id = ANY($${paramIndex}::uuid[])`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    if (search) {
      whereClause += ` AND (cn.credit_note_number ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex} OR i.invoice_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Get total count
    const countResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0]?.total || '0');

    // Get paginated results
    const result = await pool.query(`
      SELECT 
        cn.*,
        c.name as customer_name,
        c.phone as customer_phone,
        c.gstin as customer_gstin,
        i.invoice_number as invoice_number
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id
      LEFT JOIN invoices i ON cn.invoice_id = i.id
      ${whereClause}
      ORDER BY cn.credit_note_date DESC, cn.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, limit, offset]);

    return NextResponse.json({ 
      creditNotes: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching credit notes:', error);
    return NextResponse.json(
      { error: 'Failed to fetch credit notes', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/credit-notes
 * Create a new credit note (sales return - customer returns goods)
 */
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);
    const created_by = getAuthenticatedUserId(request);
    if (!business_id || !created_by) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const {
      branch_id, // MANDATORY: Branch (accounting entity) that issued this credit note
      customer_id,
      invoice_id,
      credit_note_number,
      credit_note_date,
      original_invoice_date,
      reason,
      place_of_supply_state_code,
      items,
      round_off,
      refund_status = 'pending',
      refund_mode,
      refund_date,
      refund_amount,
      notes,
    } = body;

    if (!customer_id || !credit_note_number || !credit_note_date || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'customer_id, credit_note_number, credit_note_date, and items are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    // If invoice_id provided, try to get branch_id from invoice first
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && invoice_id) {
      const invoiceRes = await client.query(`
        SELECT branch_id FROM invoices WHERE id = $1 AND business_id = $2
      `, [invoice_id, business_id]);
      
      if (invoiceRes.rows.length > 0 && invoiceRes.rows[0].branch_id) {
        resolvedBranchId = invoiceRes.rows[0].branch_id;
      }
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: resolvedBranchId,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    try {
      await authorize(created_by, 'credit_notes', 'create', { 
        businessId: business_id,
        branchId: finalBranchId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    try {
      await enforceAccess({
        businessId: business_id,
        userId: created_by,
        branchId: finalBranchId,
        feature: FeatureKeys.CREDIT_NOTES,
        limitType: 'credit_notes',
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
    try {
      await assertGstPeriodNotFiledForDocumentDate(business_id, finalBranchId, credit_note_date, 'save credit note');
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'GST period is filed',
          code: 'GST_PERIOD_FILED',
        },
        { status: 403 }
      );
    }

    const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
    try {
      await assertPeriodNotLocked(business_id, finalBranchId, credit_note_date, 'credit note');
    } catch (error: any) {
      return NextResponse.json(
        {
          error: error.message || 'Period is locked',
          code: 'PERIOD_LOCKED',
        },
        { status: 403 }
      );
    }

    await client.query('BEGIN');
    const creditNote = await createCreditNoteInTransaction(client, {
      businessId: business_id,
      branchId: finalBranchId,
      userId: created_by,
      customerId: customer_id,
      invoiceId: invoice_id || null,
      creditNoteNumber: credit_note_number,
      creditNoteDate: credit_note_date,
      originalInvoiceDate: original_invoice_date || null,
      reason,
      placeOfSupplyStateCode: place_of_supply_state_code || null,
      items,
      roundOff: round_off,
      refundStatus: refund_status,
      refundMode: refund_mode,
      refundDate: refund_date,
      refundAmount: refund_amount,
      notes,
    });
    await client.query('COMMIT');

    return NextResponse.json({ creditNote }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK');
    if (error instanceof CreditNoteCreateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error creating credit note:', error);
    return NextResponse.json(
      { error: 'Failed to create credit note', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

