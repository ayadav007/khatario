import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession, getSessionScopedBusinessId, getBusinessIdFromRequest } from '@/lib/auth-helpers';

// Valid lifecycle statuses
const VALID_STATUSES = [
  'created',
  'sent',
  'waiting_for_response',
  'customer_responded_price_change',
  'agreed_to_customer_price',
  'did_not_agree',
  'sale_made',
  'converted_to_tax_invoice',
  'cancelled'
] as const;

type LifecycleStatus = typeof VALID_STATUSES[number];

/**
 * GET /api/invoices/[id]/proforma-lifecycle
 * Get lifecycle timeline for a proforma invoice
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { id: invoiceId } = params;

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      // Verify invoice exists and is a proforma invoice
      // Try to select lifecycle columns, but handle if they don't exist yet
      let invoiceRes;
      try {
        invoiceRes = await client.query(
          `SELECT id, document_type, proforma_lifecycle_status, proforma_lifecycle_notes
           FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [invoiceId, businessScope]
        );
      } catch (colError: any) {
        // If columns don't exist, try without them
        if (colError.code === '42703') { // Undefined column
          console.warn('proforma_lifecycle columns do not exist. Please run migration 090_proforma_lifecycle.sql');
          invoiceRes = await client.query(
            `SELECT id, document_type
             FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
            [invoiceId, businessScope]
          );
        } else {
          throw colError;
        }
      }

      if (invoiceRes.rows.length === 0) {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      const invoice = invoiceRes.rows[0];
      
      if (invoice.document_type !== 'proforma_invoice') {
        return NextResponse.json(
          { error: 'This endpoint is only for proforma invoices' },
          { status: 400 }
        );
      }

      // Fetch timeline (handle case where table might not exist yet)
      let timeline: any[] = [];
      try {
        const timelineRes = await client.query(
          `SELECT 
            plt.id,
            plt.status,
            plt.notes,
            plt.created_by,
            plt.created_at,
            u.name as created_by_name
           FROM proforma_lifecycle_timeline plt
           LEFT JOIN users u ON plt.created_by = u.id
           WHERE plt.invoice_id = $1
           ORDER BY plt.created_at ASC`,
          [invoiceId]
        );
        timeline = timelineRes.rows;
      } catch (timelineError: any) {
        // Table might not exist if migration hasn't run yet
        if (timelineError.code === '42P01') { // Table does not exist
          console.warn('proforma_lifecycle_timeline table does not exist. Please run migration 090_proforma_lifecycle.sql');
          timeline = [];
        } else {
          throw timelineError;
        }
      }

      return NextResponse.json({
        current_status: invoice.proforma_lifecycle_status || 'created',
        current_notes: invoice.proforma_lifecycle_notes || null,
        timeline: timeline
      }, { status: 200 });

    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error fetching proforma lifecycle:', error);
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      detail: error.detail,
      stack: error.stack
    });
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch proforma lifecycle',
      code: error.code,
      hint: error.code === '42703' ? 'Database columns missing. Please run migration 090_proforma_lifecycle.sql' : undefined
    }, { status: 500 });
  }
}

/**
 * POST /api/invoices/[id]/proforma-lifecycle
 * Update lifecycle status for a proforma invoice
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { id: invoiceId } = params;
    const body = await request.json();
    const { status, notes, userId } = body;

    // Get user ID from request body, headers, or query params
    const finalUserId = userId || getUserIdFromRequest(request, body);

    if (!finalUserId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 401 });
    }

    // Validate status
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    const businessScope =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Verify invoice exists and is a proforma invoice
      let invoiceRes;
      try {
        invoiceRes = await client.query(
          `SELECT id, document_type, proforma_lifecycle_status
           FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
          [invoiceId, businessScope]
        );
      } catch (colError: any) {
        // If columns don't exist, try without them
        if (colError.code === '42703') { // Undefined column
          console.warn('proforma_lifecycle columns do not exist. Please run migration 090_proforma_lifecycle.sql');
          invoiceRes = await client.query(
            `SELECT id, document_type
             FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
            [invoiceId, businessScope]
          );
        } else {
          throw colError;
        }
      }

      if (invoiceRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }

      const invoice = invoiceRes.rows[0];
      
      if (invoice.document_type !== 'proforma_invoice') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'This endpoint is only for proforma invoices' },
          { status: 400 }
        );
      }

      // Update invoice lifecycle status (handle if columns don't exist)
      try {
        await client.query(
          `UPDATE invoices 
           SET proforma_lifecycle_status = $1,
               proforma_lifecycle_notes = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND business_id = $4 AND deleted_at IS NULL`,
          [status, notes || null, invoiceId, businessScope]
        );
      } catch (updateError: any) {
        if (updateError.code === '42703') { // Undefined column
          console.warn('proforma_lifecycle columns do not exist. Please run migration 090_proforma_lifecycle.sql');
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'Database migration required. Please run migration 090_proforma_lifecycle.sql' },
            { status: 500 }
          );
        } else {
          throw updateError;
        }
      }

      // Add timeline entry (handle case where table might not exist yet)
      try {
        await client.query(
          `INSERT INTO proforma_lifecycle_timeline (invoice_id, status, notes, created_by)
           VALUES ($1, $2, $3, $4)`,
          [invoiceId, status, notes || null, finalUserId]
        );
      } catch (timelineError: any) {
        // Table might not exist if migration hasn't run yet
        if (timelineError.code === '42P01') { // Table does not exist
          console.warn('proforma_lifecycle_timeline table does not exist. Please run migration 090_proforma_lifecycle.sql');
          // Continue without timeline entry - invoice status will still be updated
        } else {
          throw timelineError;
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        status,
        notes,
        message: 'Lifecycle status updated successfully'
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error updating proforma lifecycle:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

