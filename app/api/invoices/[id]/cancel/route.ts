import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { cancelPostedInvoiceInTransaction } from '@/lib/invoices/cancel-final-invoice';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  try {
    const body = await request.json().catch(() => ({}));
    const { reason } = body ?? {};

    const cancelled_by = getAuthenticatedUserId(request);
    if (!cancelled_by) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const businessScope = getSessionScopedBusinessId(request);
    if (!businessScope) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const inv = await queryOne(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, businessScope]
    );
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // AUTHORIZATION: Check cancel permission (PBAC will check status, period lock, etc.)
    try {
      await authorize(cancelled_by, 'invoices', 'cancel', { 
        branchId: inv.branch_id,
        businessId: inv.business_id,
        resourceId: id,
        invoice_date: inv.invoice_date,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (inv.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 409 });
    }

    if (inv.status === 'final' && inv.document_type !== 'proforma_invoice') {
      const notes = await queryOne<{ n: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM credit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active') +
           (SELECT COUNT(*) FROM debit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active')
         )::text AS n`,
        [id, businessScope]
      );
      if (Number(notes?.n || 0) > 0) {
        return NextResponse.json(
          {
            error:
              'This invoice has credit or debit notes against it. Cancel those notes first, then cancel the invoice.',
            code: 'INVOICE_HAS_NOTES',
          },
          { status: 409 }
        );
      }

      const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
      try {
        await assertGstPeriodNotFiledForDocumentDate(
          businessScope,
          inv.branch_id,
          inv.invoice_date,
          'cancel invoice (issue a credit note instead)'
        );
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message || 'GST period is filed', code: 'GST_PERIOD_FILED' },
          { status: 403 }
        );
      }
      const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
      try {
        await assertPeriodNotLocked(businessScope, inv.branch_id, inv.invoice_date, 'invoice cancellation');
      } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' }, { status: 403 });
      }
    }

    const cancellationDetails = {
      reason: reason || 'Cancelled',
      cancelled_by,
      cancelled_at: new Date().toISOString(),
    };

    const pool = getPool();
    const client = await pool.connect();
    let updated: any = null;
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ status: string }>(
        `SELECT status FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [id, businessScope]
      );
      if (!locked.rows[0] || locked.rows[0].status !== inv.status) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Invoice changed while cancelling; reload and try again', code: 'INVOICE_STATE_CHANGED' },
          { status: 409 }
        );
      }

      // A proforma never deducts stock or posts a voucher, so cancelling it does not restore either.
      if (inv.status === 'final' && inv.document_type !== 'proforma_invoice') {
        await cancelPostedInvoiceInTransaction(client, {
          invoiceId: id,
          businessId: businessScope,
          userId: cancelled_by,
          reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Cancelled',
        });
        const res = await client.query(`SELECT * FROM invoices WHERE id = $1 AND business_id = $2`, [
          id,
          businessScope,
        ]);
        updated = res.rows[0];
      } else {
      const res = await client.query(
        `UPDATE invoices
         SET status = 'cancelled',
             is_editable = false,
             balance_amount = 0,
             cancellation_details = $1,
             proforma_lifecycle_status = CASE
               WHEN document_type = 'proforma_invoice' THEN 'cancelled'
               ELSE proforma_lifecycle_status
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND business_id = $3
         RETURNING *`,
        [cancellationDetails, id, businessScope]
      );
      updated = res.rows[0];
      }

      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({ invoice: updated });
  } catch (error: any) {
    console.error('Cancel error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}


