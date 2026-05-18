import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { createPaymentLedgerEntries } from '@/lib/ledger-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoiceId = params.id;
  try {
    const body = await request.json();
    const { amount, payment_mode = 'cash', reference, payment_date } = body;
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    const userId = getUserIdFromRequest(request, body);
    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
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

    const inv = await queryOne(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [invoiceId, businessScope]
    );
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // AUTHORIZATION: Check update permission (PBAC will check status, period lock, etc.)
    try {
      await authorize(userId, 'invoices', 'update', { 
        branchId: inv.branch_id,
        businessId: inv.business_id,
        resourceId: invoiceId,
        invoice_date: inv.invoice_date,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }
    // Proforma invoices don't accept payments - they are estimates/quotes
    // Payments should only be recorded after converting to tax invoice
    if (inv.document_type === 'proforma_invoice') {
      return NextResponse.json({ 
        error: 'Cannot record payment for proforma invoice. Please convert it to a tax invoice first.' 
      }, { status: 400 });
    }
    // Allow payment on draft or final (for tax invoices)


    const paidAmount = Number(inv.paid_amount || 0) + Number(amount);
    const balance = Math.max(0, Number(inv.grand_total || 0) - paidAmount);
    let paymentStatus: 'unpaid' | 'partially_paid' | 'paid' = 'unpaid';
    if (paidAmount <= 0) paymentStatus = 'unpaid';
    else if (balance <= 0) paymentStatus = 'paid';
    else paymentStatus = 'partially_paid';

    let paymentBranchId = inv.branch_id as string | null | undefined;
    if (!paymentBranchId) {
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      try {
        paymentBranchId = await resolveBranchId({
          branchId: null,
          businessId: inv.business_id as string,
        });
      } catch (e: any) {
        return NextResponse.json(
          { error: e.message || 'Could not resolve branch for payment' },
          { status: 400 }
        );
      }
    }

    // PHASE-5: wrap payment INSERT, balance updates, and ledger posting in one
    // transaction so the deferred validate_voucher_balance trigger sees both
    // ledger lines at COMMIT. If any step throws, we ROLLBACK everything.
    const client = await getPool().connect();
    let updated: any = null;
    try {
      await client.query('BEGIN');

      const paymentRes = await client.query<{ id: string }>(
        `INSERT INTO payments (
          business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id`,
        [
          inv.business_id,
          paymentBranchId,
          'receivable',
          inv.customer_id,
          'invoice',
          inv.id,
          amount,
          payment_mode,
          payment_date || new Date(),
          reference ? String(reference) : null,
        ],
      );
      const paymentId = paymentRes.rows[0]?.id;

      if (paymentId && inv.customer_id) {
        await createPaymentLedgerEntries({
          businessId: inv.business_id,
          paymentId: paymentId,
          paymentDate: payment_date || new Date(),
          amount: amount,
          type: 'receivable',
          customerId: inv.customer_id,
          paymentMode: payment_mode || 'cash',
          referenceNumber: inv.invoice_number,
          description: `Payment for invoice ${inv.invoice_number}${reference ? ` - Ref: ${reference}` : ''}`,
          branchId: paymentBranchId,
          poolClient: client,
        });
      }

      const updatedRes = await client.query(
        `UPDATE invoices
         SET paid_amount = $1,
             balance_amount = $2,
             payment_status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [paidAmount, balance, paymentStatus, inv.id],
      );
      updated = updatedRes.rows[0];

      if (inv.customer_id) {
        await client.query(
          `UPDATE customers
           SET current_balance = current_balance - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [amount, inv.customer_id],
        );
      }

      await client.query('COMMIT');
    } catch (txError: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Invoice payment error (transaction rolled back):', txError);
      return NextResponse.json(
        {
          error: txError.message || 'Failed to record payment',
          details: txError.detail || undefined,
        },
        { status: 500 },
      );
    } finally {
      client.release();
    }

    return NextResponse.json({ invoice: updated });
  } catch (error: any) {
    console.error('Payment error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}


