import { NextRequest, NextResponse } from 'next/server';
import { queryOne, getPool } from '@/lib/db';
import { createPaymentLedgerEntries } from '@/lib/ledger-utils';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { draftDocumentPaymentError, walkInReceiptNotSupportedError } from '@/lib/accounting/final-document-payment';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const invoiceId = params.id;
  try {
    const body = await request.json();
    const { payment_mode = 'cash', reference, payment_date, tds_section } = body;
    const amount = Math.round((Number(body.amount) || 0) * 100) / 100;
    const tdsAmount = Math.round((Number(body.tds_amount) || 0) * 100) / 100;
    if (amount < 0 || tdsAmount < 0 || amount + tdsAmount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    const settles = Math.round((amount + tdsAmount) * 100) / 100;

    const userId = getAuthenticatedUserId(request);
    const businessScope = getSessionScopedBusinessId(request);
    if (!userId || !businessScope) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
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
    if (inv.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot record a payment against a cancelled invoice', code: 'INVOICE_CANCELLED' },
        { status: 400 }
      );
    }
    if (inv.status !== 'final') {
      return NextResponse.json(draftDocumentPaymentError('invoice'), { status: 409 });
    }
    if (!inv.customer_id) {
      return NextResponse.json(walkInReceiptNotSupportedError(), { status: 400 });
    }

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

    const lockRes = await periodGuardResponse({
      businessId: inv.business_id as string,
      branchId: paymentBranchId ?? null,
      dates: [payment_date || new Date()],
      action: 'record a receipt',
    });
    if (lockRes) return lockRes;

    // PHASE-5: wrap payment INSERT, balance updates, and ledger posting in one
    // transaction so the deferred validate_voucher_balance trigger sees both
    // ledger lines at COMMIT. If any step throws, we ROLLBACK everything.
    const client = await getPool().connect();
    let updated: any = null;
    try {
      await client.query('BEGIN');

      const locked = await client.query<{ status: string; customer_id: string | null }>(
        `SELECT status, customer_id FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [inv.id, inv.business_id]
      );
      if (locked.rows[0]?.status !== 'final') {
        await client.query('ROLLBACK');
        return NextResponse.json(
          locked.rows[0]?.status === 'cancelled'
            ? { error: 'Cannot record a payment against a cancelled invoice', code: 'INVOICE_CANCELLED' }
            : draftDocumentPaymentError('invoice'),
          { status: locked.rows[0]?.status === 'cancelled' ? 400 : 409 }
        );
      }
      if (!locked.rows[0]?.customer_id) {
        await client.query('ROLLBACK');
        return NextResponse.json(walkInReceiptNotSupportedError(), { status: 400 });
      }
      const current = await recomputeInvoiceBalance(client, inv.id, inv.business_id);
      const outstanding = current?.balance_amount ?? 0;
      if (settles > outstanding + 0.01) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Amount ₹${settles.toFixed(2)}${tdsAmount > 0 ? ' (including TDS)' : ''} exceeds the invoice balance of ₹${outstanding.toFixed(2)} (after credit/debit notes). Record the excess as an advance instead.`,
            code: 'PAYMENT_EXCEEDS_BALANCE',
            outstanding,
          },
          { status: 400 }
        );
      }

      const paymentRes = await client.query<{ id: string }>(
        `INSERT INTO payments (
          business_id, branch_id, type, customer_id, reference_type, reference_id,
          amount, payment_mode, payment_date, notes, tds_amount, tds_section, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
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
          tdsAmount,
          tdsAmount > 0 && tds_section ? String(tds_section).slice(0, 20) : null,
          userId,
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
          tdsAmount,
          poolClient: client,
        });
      }

      await client.query(
        `UPDATE invoices
            SET paid_amount = COALESCE(paid_amount, 0) + $1,
                tds_received = COALESCE(tds_received, 0) + $2
          WHERE id = $3 AND business_id = $4`,
        [amount, tdsAmount, inv.id, inv.business_id],
      );
      await recomputeInvoiceBalance(client, inv.id, inv.business_id);
      const updatedRes = await client.query('SELECT * FROM invoices WHERE id = $1', [inv.id]);
      updated = updatedRes.rows[0];

      if (inv.customer_id) {
        await client.query(
          `UPDATE customers
           SET current_balance = current_balance - $1,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND business_id = $3`,
          [settles, inv.customer_id, inv.business_id],
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


