/**
 * Admin diagnostic endpoint: purge test invoices
 *
 * **Hard delete**: removes invoice rows (CASCADE clears invoice_lines), wipes
 * payment rows tied to those invoices, and clears matching ledger voucher lines.
 * Not the same as tenant soft-delete / restore — intended for wiping sandbox/demo data.
 *
 *   GET    -> dry-run JSON listing what would be deleted
 *   DELETE -> executes hard purge when ?confirm=<token> matches the dry-run token
 *
 * Auth: must be authenticated AND either have settings.read or be primary admin.
 *
 * Safe to delete after the audit cleanup is complete.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, queryRows, getPool } from '@/lib/db';

async function authorize(request: NextRequest): Promise<
  { ok: true; businessId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  if (!businessId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'business_id is required' }, { status: 400 }),
    };
  }
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 }),
    };
  }

  let isAdmin = false;
  try {
    const { checkUserPermission } = await import('@/lib/permissions');
    isAdmin = await checkUserPermission(userId, 'settings', 'read');
  } catch {
    isAdmin = false;
  }
  if (!isAdmin) {
    const u = await queryOne<{ is_primary_admin: boolean }>(
      'SELECT is_primary_admin FROM users WHERE id = $1',
      [userId],
    );
    isAdmin = !!u?.is_primary_admin;
  }
  if (!isAdmin) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: admin only', code: 'NOT_ADMIN' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, businessId, userId };
}

/**
 * Build a deterministic confirm token from the business id + invoice ids.
 * The DELETE call must echo this token, so the caller cannot accidentally
 * delete a different set of invoices than they previewed.
 */
function buildConfirmToken(businessId: string, invoiceIds: string[]): string {
  const sorted = [...invoiceIds].sort().join('|');
  // Lightweight non-crypto hash; enough as a "did you really mean it" guard.
  let h = 0;
  const s = `${businessId}::${sorted}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `PURGE_${(h >>> 0).toString(16).padStart(8, '0')}_${invoiceIds.length}`;
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  document_type: string | null;
  customer_id: string | null;
  branch_id: string | null;
  grand_total: string;
}

async function loadTargetInvoices(businessId: string): Promise<InvoiceRow[]> {
  return await queryRows<InvoiceRow>(
    `SELECT
       id::text,
       invoice_number,
       invoice_date::text         AS invoice_date,
       status,
       document_type,
       customer_id::text          AS customer_id,
       branch_id::text            AS branch_id,
       grand_total::text          AS grand_total
     FROM invoices
     WHERE business_id = $1
       AND (document_type IS NULL OR document_type != 'proforma_invoice')
       AND deleted_at IS NULL
     ORDER BY invoice_date DESC, invoice_number DESC`,
    [businessId],
  );
}

async function buildDryRun(businessId: string) {
  const invoices = await loadTargetInvoices(businessId);
  const ids = invoices.map((i) => i.id);

  if (ids.length === 0) {
    return {
      business_id: businessId,
      invoices_to_delete: [],
      counts: {
        invoices: 0,
        invoice_items: 0,
        payments: 0,
        ledger_entry_lines: 0,
      },
      confirm_token: null,
      delete_url: null,
      note: 'No non-proforma invoices to delete.',
    };
  }

  const itemCount = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM invoice_items WHERE invoice_id = ANY($1::uuid[])`,
    [ids],
  );
  const paymentCount = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM payments
      WHERE business_id = $1
        AND reference_type = 'invoice'
        AND reference_id = ANY($2::uuid[])`,
    [businessId, ids],
  );
  const ledgerCount = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM ledger_entry_lines
      WHERE business_id = $1
        AND voucher_type = 'invoice'
        AND voucher_id = ANY($2::uuid[])`,
    [businessId, ids],
  );
  // PHASE-2: also count payment-voucher ledger lines (Dr Cash, Cr AR receipts
  // that are now created at invoice time for credit invoices) so the dry-run
  // shows the FULL ledger impact, not just the invoice-side.
  const paymentLedgerCount = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM ledger_entry_lines
      WHERE business_id = $1
        AND voucher_type = 'payment'
        AND voucher_id IN (
          SELECT id FROM payments
           WHERE business_id = $1
             AND reference_type = 'invoice'
             AND reference_id = ANY($2::uuid[])
        )`,
    [businessId, ids],
  );

  const confirmToken = buildConfirmToken(businessId, ids);

  return {
    business_id: businessId,
    invoices_to_delete: invoices.map((i) => ({
      id: i.id,
      number: i.invoice_number,
      date: i.invoice_date,
      status: i.status,
      grand_total: Number(i.grand_total),
    })),
    counts: {
      invoices: invoices.length,
      invoice_items: Number(itemCount?.n ?? 0),
      payments: Number(paymentCount?.n ?? 0),
      ledger_entry_lines: Number(ledgerCount?.n ?? 0) + Number(paymentLedgerCount?.n ?? 0),
      ledger_entry_lines_invoice: Number(ledgerCount?.n ?? 0),
      ledger_entry_lines_payment: Number(paymentLedgerCount?.n ?? 0),
    },
    confirm_token: confirmToken,
    delete_url:
      `/api/admin/diagnostics/purge-invoices` +
      `?business_id=${businessId}` +
      `&user_id=<your_user_id>` +
      `&confirm=${confirmToken}`,
    note:
      'Send a DELETE request to delete_url to perform the purge. The confirm ' +
      'token binds to the exact invoice ids previewed here; if anything changes ' +
      'in between, you must re-run the dry-run.',
  };
}

// -----------------------------------------------------------------------
// GET: dry-run
// -----------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;
    const dryRun = await buildDryRun(auth.businessId);
    return NextResponse.json(dryRun);
  } catch (error) {
    const err = error as { message?: string };
    console.error('purge-invoices GET error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// -----------------------------------------------------------------------
// DELETE: execute (requires ?confirm=<token>)
// -----------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const provided = searchParams.get('confirm');
    if (!provided) {
      return NextResponse.json(
        { error: 'confirm query param required. Hit GET first to obtain the token.' },
        { status: 400 },
      );
    }

    // Re-load the invoice list and recompute the token so the caller cannot
    // re-use a stale token to delete a different set than they previewed.
    const invoices = await loadTargetInvoices(auth.businessId);
    const ids = invoices.map((i) => i.id);

    if (ids.length === 0) {
      return NextResponse.json({ deleted: false, reason: 'Nothing to delete.' });
    }

    const expected = buildConfirmToken(auth.businessId, ids);
    if (provided !== expected) {
      return NextResponse.json(
        {
          error: 'confirm token mismatch. Re-run GET to fetch the current token.',
          expected,
          provided,
        },
        { status: 409 },
      );
    }

    await client.query('BEGIN');

    // 1a. Orphan invoice-voucher ledger lines (no FK, defensive)
    const ledgerInvoiceDel = await client.query(
      `DELETE FROM ledger_entry_lines
        WHERE business_id = $1
          AND voucher_type = 'invoice'
          AND voucher_id = ANY($2::uuid[])`,
      [auth.businessId, ids],
    );

    // 1b. PHASE-2: payment-voucher ledger lines (Dr Cash, Cr AR receipts
    // posted alongside credit invoices). Must be deleted BEFORE the payments
    // they reference, otherwise the voucher_id would orphan.
    const ledgerPaymentDel = await client.query(
      `DELETE FROM ledger_entry_lines
        WHERE business_id = $1
          AND voucher_type = 'payment'
          AND voucher_id IN (
            SELECT id FROM payments
             WHERE business_id = $1
               AND reference_type = 'invoice'
               AND reference_id = ANY($2::uuid[])
          )`,
      [auth.businessId, ids],
    );

    // 2. Payment rows (no FK from payments to invoices — remove before invoice DELETE)
    const paymentsDel = await client.query(
      `DELETE FROM payments
        WHERE business_id = $1
          AND reference_type = 'invoice'
          AND reference_id = ANY($2::uuid[])`,
      [auth.businessId, ids],
    );

    // 3. Invoices (invoice_items CASCADE; soft-deleted rows are not in `ids` from loadTargetInvoices)
    const invoicesDel = await client.query(
      `DELETE FROM invoices
        WHERE business_id = $1
          AND id = ANY($2::uuid[])`,
      [auth.businessId, ids],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      deleted: true,
      business_id: auth.businessId,
      counts: {
        ledger_entry_lines: (ledgerInvoiceDel.rowCount ?? 0) + (ledgerPaymentDel.rowCount ?? 0),
        ledger_entry_lines_invoice: ledgerInvoiceDel.rowCount ?? 0,
        ledger_entry_lines_payment: ledgerPaymentDel.rowCount ?? 0,
        payments: paymentsDel.rowCount ?? 0,
        invoices: invoicesDel.rowCount ?? 0,
      },
      deleted_invoice_numbers: invoices.map((i) => i.invoice_number),
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // swallow
    }
    const err = error as { message?: string };
    console.error('purge-invoices DELETE error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
