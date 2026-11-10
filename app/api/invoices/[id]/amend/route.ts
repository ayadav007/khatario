import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { reverseInvoicePostingForRepost } from '@/lib/invoices/invoice-edit-postings';
import { activeLedgerLineSql } from '@/lib/ledger-reversal';
import { markGstReadinessStale } from '@/lib/gst/period-freshness';
import { isInvoiceInFiledGstr1 } from '@/lib/invoices/gstr1-filed';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { parseChangeReason, setInvoiceAuditContext } from '@/lib/invoices/invoice-audit-context';

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

/** Printed fields that do not touch the tax. Each one changes only when the request sends it. */
const AMEND_TEXT_FIELDS: Array<{ column: string; label: string; max: number }> = [
  { column: 'shipping_address', label: 'Ship-to address', max: 2000 },
  { column: 'notes', label: 'Notes', max: 5000 },
  { column: 'payment_terms', label: 'Terms of payment', max: 1000 },
  { column: 'terms_of_delivery', label: 'Terms of delivery', max: 1000 },
  { column: 'purchase_order_number', label: 'PO number', max: 100 },
  { column: 'reference_number', label: 'Reference number', max: 100 },
  { column: 'eway_bill_number', label: 'E-way bill number', max: 100 },
  { column: 'delivery_note', label: 'Delivery note', max: 255 },
  { column: 'other_references', label: 'Other references', max: 255 },
  { column: 'dispatched_through', label: 'Dispatched through', max: 255 },
  { column: 'destination', label: 'Destination', max: 255 },
];
const AMEND_DATE_FIELDS: Array<{ column: string; label: string }> = [
  { column: 'purchase_order_date', label: 'PO date' },
  { column: 'eway_bill_date', label: 'E-way bill date' },
];

/**
 * PATCH /api/invoices/[id]/amend
 * After finalization, change the invoice date, due date, billing address, the name printed
 * on this bill, the ship-to address, notes, and the PO / e-way bill / dispatch references.
 * Place of supply, items, amounts, and the customer master stay put.
 * An optional `reason` (up to 500 characters) is kept in the invoice's history.
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

  const extras: Array<{ column: string; value: string | null }> = [];
  for (const f of AMEND_TEXT_FIELDS) {
    if (!(f.column in body)) continue;
    const value = body[f.column] == null ? '' : String(body[f.column]).trim();
    if (value.length > f.max) {
      return NextResponse.json({ error: `${f.label} is too long.`, code: 'FIELD_TOO_LONG' }, { status: 400 });
    }
    extras.push({ column: f.column, value: value || null });
  }
  for (const f of AMEND_DATE_FIELDS) {
    if (!(f.column in body)) continue;
    const value = parseDate(body[f.column]);
    if (value === 'invalid') {
      return NextResponse.json({ error: `Enter a valid ${f.label}, or leave it blank.`, code: 'INVALID_DATE' }, { status: 400 });
    }
    extras.push({ column: f.column, value });
  }

  const reason = parseChangeReason(body.reason);
  if (reason === 'too_long') {
    return NextResponse.json({ error: 'Reason for change is too long.', code: 'REASON_TOO_LONG' }, { status: 400 });
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
    eway_bill_number: string | null;
  }>(
    `SELECT i.id, i.branch_id, i.status, i.document_type, i.invoice_number, i.invoice_date, i.due_date,
            i.eway_bill_number, c.name AS customer_name
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
  if (await isInvoiceInFiledGstr1(pool, params.id)) {
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

  const newEwayBill = extras.find((e) => e.column === 'eway_bill_number')?.value;
  if (newEwayBill && newEwayBill !== (inv.eway_bill_number || '').trim()) {
    try {
      await assertFeatureAccess(businessId, 'eway_bill');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }
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
    await setInvoiceAuditContext(client, { actorUserId: userId, action: 'amended', reason });
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

    // Column names come from the fixed lists above, never from the request.
    const extraSet = (firstParam: number) =>
      extras.map((e, i) => `,\n                ${e.column} = $${firstParam + i}`).join('');
    const extraValues = extras.map((e) => e.value);

    await client.query('SAVEPOINT amend_invoice');
    try {
      await client.query(
        `UPDATE invoices
            SET invoice_date = $3::date,
                due_date = $4::date,
                billing_address = $5,
                billing_name = $6${extraSet(7)},
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [params.id, businessId, invoiceDate, dueDate, address, printedName, ...extraValues],
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
                billing_address = $5${extraSet(6)},
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [params.id, businessId, invoiceDate, dueDate, address, ...extraValues],
      );
    }

    if (dateChanged) {
      const posted = await client.query<{
        id: string;
        account_id: string;
        debit: string;
        credit: string;
        narration: string | null;
        reference_number: string | null;
        branch_id: string | null;
      }>(
        `SELECT l.id, l.account_id, l.debit, l.credit, l.narration, l.reference_number, l.branch_id
           FROM ledger_entry_lines l
          WHERE l.business_id = $1 AND l.voucher_type = 'invoice' AND l.voucher_id = $2
            AND ${activeLedgerLineSql('l')}
          ORDER BY l.created_at, l.id`,
        [businessId, params.id],
      );

      // A customer moved to another receivable account since this invoice was posted: the
      // reversal below carries the old receivable line to the customer's current account, so
      // the line is posted back there, not on the account the move already settled.
      const { customerSweptLines } = await import('@/lib/accounting/receivable-account-move');
      const moved = await customerSweptLines(client, {
        businessId,
        voucherType: 'invoice',
        voucherId: params.id,
        lines: posted.rows.map((l) => ({ id: l.id, account_id: l.account_id })),
      });

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
            moved?.sweptLineIds.has(line.id) ? moved.currentAccountId : line.account_id,
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
      ...Object.fromEntries(extras.map((e) => [e.column, e.value])),
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
