import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { reverseInvoicePostingForRepost } from '@/lib/invoices/invoice-edit-postings';
import { activeLedgerLineSql } from '@/lib/ledger-reversal';
import { markGstReadinessStale } from '@/lib/gst/period-freshness';

export const dynamic = 'force-dynamic';

function dateOnly(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

function parseDate(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 'invalid';
  const [y, m, d] = s.split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return 'invalid';
  }
  return s;
}

/**
 * PATCH /api/invoices/[id]/amend
 * After finalization, change only the invoice date, due date, billing address,
 * and the name printed on this bill. Amounts, items, and the customer master stay put.
 * A date change reverses the invoice voucher and posts it again on the new date.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const invoiceDate = parseDate(body.invoice_date);
  const dueDate = parseDate(body.due_date);
  if (invoiceDate === 'invalid' || !invoiceDate) {
    return NextResponse.json({ error: 'Enter a valid invoice date.', code: 'INVALID_DATE' }, { status: 400 });
  }
  if (dueDate === 'invalid') {
    return NextResponse.json({ error: 'Enter a valid due date, or leave it blank.', code: 'INVALID_DUE_DATE' }, { status: 400 });
  }
  if (dueDate && dueDate < invoiceDate) {
    return NextResponse.json({ error: 'Due date cannot be before the invoice date.', code: 'DUE_BEFORE_INVOICE' }, { status: 400 });
  }

  const billingAddress = body.billing_address == null ? '' : String(body.billing_address);
  if (billingAddress.length > 2000) {
    return NextResponse.json({ error: 'Billing address is too long.', code: 'ADDRESS_TOO_LONG' }, { status: 400 });
  }
  const billingNameRaw = body.billing_name == null ? '' : String(body.billing_name).trim();
  if (billingNameRaw.length > 255) {
    return NextResponse.json({ error: 'Customer name is too long.', code: 'NAME_TOO_LONG' }, { status: 400 });
  }

  const pool = getPool();
  const existing = await pool.query<{
    id: string;
    branch_id: string | null;
    status: string;
    document_type: string | null;
    invoice_number: string;
    invoice_date: string | Date;
    due_date: string | Date | null;
    customer_name: string | null;
    is_editable: boolean | null;
  }>(
    `SELECT i.id, i.branch_id, i.status, i.document_type, i.invoice_number, i.invoice_date, i.due_date,
            c.name AS customer_name, i.is_editable
       FROM invoices i
       LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
      WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
    [params.id, businessId],
  );
  const inv = existing.rows[0];
  if (!inv) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }
  if (inv.status === 'cancelled') {
    return NextResponse.json({ error: 'A cancelled invoice cannot be amended.', code: 'INVOICE_CANCELLED' }, { status: 409 });
  }
  if (inv.status !== 'final' || inv.document_type === 'proforma_invoice') {
    return NextResponse.json(
      { error: 'Only a finalized invoice can be amended here. Open the draft to edit it.', code: 'NOT_FINAL' },
      { status: 409 },
    );
  }
  if (inv.is_editable === false) {
    return NextResponse.json(
      {
        error: 'This invoice is locked and cannot be amended because it was included in a GSTR-1 filing.',
        code: 'GSTR1_LOCKED',
      },
      { status: 403 },
    );
  }

  try {
    await authorize(userId, 'invoices', 'update', {
      businessId,
      branchId: inv.branch_id || undefined,
      resourceId: params.id,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const previousDate = dateOnly(inv.invoice_date);
  const dateChanged = previousDate !== invoiceDate;
  const printedName = billingNameRaw && billingNameRaw !== (inv.customer_name || '').trim() ? billingNameRaw : null;
  const address = billingAddress.trim() ? billingAddress.trim() : null;

  const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
  const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
  try {
    await assertGstPeriodNotFiledForDocumentDate(businessId, inv.branch_id, previousDate, 'amend this invoice');
    if (dateChanged) {
      await assertGstPeriodNotFiledForDocumentDate(businessId, inv.branch_id, invoiceDate, 'move this invoice date');
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'GST period is filed', code: 'GST_PERIOD_FILED' },
      { status: 403 },
    );
  }

  if (dateChanged) {
    const notes = await pool.query<{ n: string }>(
      `SELECT (
         (SELECT COUNT(*) FROM credit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active') +
         (SELECT COUNT(*) FROM debit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active')
       )::text AS n`,
      [params.id, businessId],
    );
    if (Number(notes.rows[0]?.n || 0) > 0) {
      return NextResponse.json(
        {
          error: 'This invoice has credit or debit notes. The date cannot move until those notes are cancelled. Address, name, and due date can still be changed.',
          code: 'INVOICE_HAS_NOTES',
        },
        { status: 409 },
      );
    }
    try {
      await assertPeriodNotLocked(businessId, inv.branch_id, previousDate, 'invoice date amendment');
      await assertPeriodNotLocked(businessId, inv.branch_id, invoiceDate, 'invoice date amendment');
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' },
        { status: 403 },
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{ status: string; document_type: string | null }>(
      `SELECT status, document_type FROM invoices
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [params.id, businessId],
    );
    const row = locked.rows[0];
    if (!row || row.status !== 'final' || row.document_type === 'proforma_invoice') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'Invoice changed while saving. Reload and try again.', code: 'INVOICE_STATE_CHANGED' },
        { status: 409 },
      );
    }

    await client.query('SAVEPOINT amend_invoice');
    try {
      await client.query(
        `UPDATE invoices
            SET invoice_date = $3::date,
                due_date = $4::date,
                billing_address = $5,
                billing_name = $6,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [params.id, businessId, invoiceDate, dueDate, address, printedName],
      );
      await client.query('RELEASE SAVEPOINT amend_invoice');
    } catch (error: any) {
      if (error?.code !== '42703') throw error;
      await client.query('ROLLBACK TO SAVEPOINT amend_invoice');
      if (printedName) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: 'The printed-name column is not on this database yet. Run migration 413_invoice_billing_name.sql, then try again.',
            code: 'MIGRATION_REQUIRED',
          },
          { status: 503 },
        );
      }
      await client.query(
        `UPDATE invoices
            SET invoice_date = $3::date,
                due_date = $4::date,
                billing_address = $5,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [params.id, businessId, invoiceDate, dueDate, address],
      );
    }

    if (dateChanged) {
      const posted = await client.query<{
        account_id: string;
        debit: string;
        credit: string;
        narration: string | null;
        reference_number: string | null;
        branch_id: string | null;
      }>(
        `SELECT l.account_id, l.debit, l.credit, l.narration, l.reference_number, l.branch_id
           FROM ledger_entry_lines l
          WHERE l.business_id = $1 AND l.voucher_type = 'invoice' AND l.voucher_id = $2
            AND ${activeLedgerLineSql('l')}
          ORDER BY l.created_at, l.id`,
        [businessId, params.id],
      );

      await reverseInvoicePostingForRepost(client, {
        businessId,
        invoiceId: params.id,
        invoiceNumber: inv.invoice_number,
        userId,
      });

      for (const line of posted.rows) {
        await client.query(
          `INSERT INTO ledger_entry_lines (
             business_id, voucher_id, voucher_type, account_id, entry_date,
             debit, credit, narration, reference_number, branch_id
           ) VALUES ($1, $2, 'invoice', $3, $4::date, $5, $6, $7, $8, $9)`,
          [
            businessId,
            params.id,
            line.account_id,
            invoiceDate,
            line.debit,
            line.credit,
            line.narration,
            line.reference_number,
            line.branch_id,
          ],
        );
      }

      await markGstReadinessStale(client, businessId, { dates: [previousDate, invoiceDate] });
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      invoice_date: invoiceDate,
      due_date: dueDate,
      billing_address: address,
      billing_name: printedName,
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Invoice amend failed:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to amend the invoice', code: 'AMEND_FAILED' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
