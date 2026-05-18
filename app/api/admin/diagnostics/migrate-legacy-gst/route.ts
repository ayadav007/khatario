/**
 * Admin diagnostic endpoint: migrate legacy pre-Phase-3 GST out of Sales (4101)
 * into the new Output GST split accounts (2150 / 2151 / 2152 / 2153).
 *
 * Background: before migration 166, every invoice posted its FULL grand_total
 * (taxable + CGST + SGST + IGST + Cess) as a credit to Sales. After Phase-3
 * the new split accounts exist and new invoices post correctly, but historical
 * postings still sit in Sales — meaning the Sales line on Trial Balance and
 * P&L is inflated by the historical GST. This endpoint posts ONE balanced
 * journal voucher per business that:
 *
 *   Dr Sales  (4101)             totalCgst + totalSgst + totalIgst + totalCess
 *     Cr Output CGST  (2150)     totalCgst
 *     Cr Output SGST  (2151)     totalSgst
 *     Cr Output IGST  (2152)     totalIgst
 *     Cr Output Cess  (2153)     totalCess
 *
 * Where the totals are summed from `invoices` (status='final', not proforma)
 * MINUS whatever has already been credited to those split accounts via
 * post-Phase-3 invoices. So calling this twice in a row is idempotent — the
 * second call will see "everything already migrated, nothing to do".
 *
 *   GET  -> dry-run JSON (counts + confirm token + sample invoice ids)
 *   POST -> execute the JV when ?confirm=<token> matches
 *
 * Auth: same admin gate as the other diagnostic endpoints.
 *
 * Safe to delete after the user has been on Phase-3 for a few months.
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
    return { ok: false, response: NextResponse.json({ error: 'business_id is required' }, { status: 400 }) };
  }
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 }) };
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
      response: NextResponse.json({ error: 'Forbidden: admin only', code: 'NOT_ADMIN' }, { status: 403 }),
    };
  }
  return { ok: true, businessId, userId };
}

// Deterministic token bound to the exact gap that would be moved — so if the
// user creates a new invoice between dry-run and POST, the token won't match
// and they'll have to re-preview.
function buildConfirmToken(businessId: string, gap: { cgst: number; sgst: number; igst: number; cess: number }): string {
  const sig = `${businessId}::${gap.cgst.toFixed(2)}|${gap.sgst.toFixed(2)}|${gap.igst.toFixed(2)}|${gap.cess.toFixed(2)}`;
  let h = 0;
  for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
  return `MIGRATE_GST_${(h >>> 0).toString(16).padStart(8, '0')}`;
}

interface AccountRow {
  id: string;
  account_code: string;
  account_name: string;
}

interface DryRunBody {
  business_id: string;
  totals_from_invoices: { cgst: number; sgst: number; igst: number; cess: number; tax: number };
  already_in_split_accounts: { cgst: number; sgst: number; igst: number; cess: number };
  gap_to_migrate: { cgst: number; sgst: number; igst: number; cess: number; total: number };
  invoice_count_in_scope: number;
  sample_invoices: Array<{ id: string; number: string; date: string; cgst: number; sgst: number; igst: number; grand_total: number }>;
  accounts: {
    sales: AccountRow | null;
    output_cgst: AccountRow | null;
    output_sgst: AccountRow | null;
    output_igst: AccountRow | null;
    output_cess: AccountRow | null;
  };
  ready_to_migrate: boolean;
  confirm_token: string | null;
  post_url: string | null;
  notes: string[];
}

async function buildDryRun(businessId: string): Promise<DryRunBody> {
  // Pull totals from the SOURCE OF TRUTH (the invoice header columns).
  const invoiceTotals = await queryOne<{
    cgst: string; sgst: string; igst: string; n: string;
  }>(
    `SELECT
       COALESCE(SUM(cgst_total),0)::text AS cgst,
       COALESCE(SUM(sgst_total),0)::text AS sgst,
       COALESCE(SUM(igst_total),0)::text AS igst,
       COUNT(*)::text                    AS n
     FROM invoices
     WHERE business_id = $1
       AND status = 'final'
       AND (document_type IS NULL OR document_type != 'proforma_invoice')`,
    [businessId],
  );

  const invoiceCount = Number(invoiceTotals?.n ?? 0);
  const totalsFromInvoices = {
    cgst: Number(invoiceTotals?.cgst ?? 0),
    sgst: Number(invoiceTotals?.sgst ?? 0),
    igst: Number(invoiceTotals?.igst ?? 0),
    cess: 0, // no cess column at the moment
    tax: 0,
  };
  totalsFromInvoices.tax =
    totalsFromInvoices.cgst + totalsFromInvoices.sgst + totalsFromInvoices.igst + totalsFromInvoices.cess;

  // What's already been correctly credited to the split accounts (post-Phase-3 invoices)
  const splitBalances = await queryOne<{ cgst: string; sgst: string; igst: string; cess: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN a.account_code = '2150' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS cgst,
       COALESCE(SUM(CASE WHEN a.account_code = '2151' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS sgst,
       COALESCE(SUM(CASE WHEN a.account_code = '2152' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS igst,
       COALESCE(SUM(CASE WHEN a.account_code = '2153' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS cess
     FROM ledger_entry_lines lel
     JOIN accounts a ON a.id = lel.account_id
     WHERE lel.business_id = $1
       AND a.account_code IN ('2150','2151','2152','2153')`,
    [businessId],
  );
  const alreadyInSplit = {
    cgst: Number(splitBalances?.cgst ?? 0),
    sgst: Number(splitBalances?.sgst ?? 0),
    igst: Number(splitBalances?.igst ?? 0),
    cess: Number(splitBalances?.cess ?? 0),
  };

  const gap = {
    cgst: Math.max(0, Number((totalsFromInvoices.cgst - alreadyInSplit.cgst).toFixed(2))),
    sgst: Math.max(0, Number((totalsFromInvoices.sgst - alreadyInSplit.sgst).toFixed(2))),
    igst: Math.max(0, Number((totalsFromInvoices.igst - alreadyInSplit.igst).toFixed(2))),
    cess: Math.max(0, Number((totalsFromInvoices.cess - alreadyInSplit.cess).toFixed(2))),
    total: 0,
  };
  gap.total = Number((gap.cgst + gap.sgst + gap.igst + gap.cess).toFixed(2));

  // Sample invoices for transparency
  const sample = await queryRows<{
    id: string; invoice_number: string; invoice_date: string;
    cgst: string; sgst: string; igst: string; grand_total: string;
  }>(
    `SELECT id::text, invoice_number,
            invoice_date::text   AS invoice_date,
            cgst_total::text     AS cgst,
            sgst_total::text     AS sgst,
            igst_total::text     AS igst,
            grand_total::text    AS grand_total
       FROM invoices
      WHERE business_id = $1
        AND status = 'final'
        AND (document_type IS NULL OR document_type != 'proforma_invoice')
        AND (cgst_total > 0 OR sgst_total > 0 OR igst_total > 0)
      ORDER BY invoice_date DESC, invoice_number DESC
      LIMIT 10`,
    [businessId],
  );

  // Account resolution
  const accountRows = await queryRows<AccountRow>(
    `SELECT id::text, account_code, account_name
       FROM accounts
      WHERE business_id = $1
        AND account_code IN ('4101','2150','2151','2152','2153')`,
    [businessId],
  );
  const byCode: Record<string, AccountRow | undefined> = {};
  for (const a of accountRows) byCode[a.account_code] = a;

  const notes: string[] = [];
  if (!byCode['4101']) notes.push('Sales account 4101 not found — cannot migrate.');
  if (!byCode['2150']) notes.push('Output CGST account 2150 not found — run migration 166.');
  if (!byCode['2151']) notes.push('Output SGST account 2151 not found — run migration 166.');
  if (!byCode['2152']) notes.push('Output IGST account 2152 not found — run migration 166.');
  if (gap.total === 0 && invoiceCount > 0) {
    notes.push('Nothing to migrate — your Output GST split accounts already match the invoice totals (or the gap was already migrated).');
  }
  if (invoiceCount === 0) {
    notes.push('No final invoices found for this business — nothing to migrate.');
  }

  const readyToMigrate =
    gap.total > 0 &&
    !!byCode['4101'] && !!byCode['2150'] && !!byCode['2151'] && !!byCode['2152'];

  const confirmToken = readyToMigrate ? buildConfirmToken(businessId, gap) : null;

  return {
    business_id: businessId,
    totals_from_invoices: totalsFromInvoices,
    already_in_split_accounts: alreadyInSplit,
    gap_to_migrate: gap,
    invoice_count_in_scope: invoiceCount,
    sample_invoices: sample.map((s) => ({
      id: s.id,
      number: s.invoice_number,
      date: s.invoice_date,
      cgst: Number(s.cgst),
      sgst: Number(s.sgst),
      igst: Number(s.igst),
      grand_total: Number(s.grand_total),
    })),
    accounts: {
      sales: byCode['4101'] ?? null,
      output_cgst: byCode['2150'] ?? null,
      output_sgst: byCode['2151'] ?? null,
      output_igst: byCode['2152'] ?? null,
      output_cess: byCode['2153'] ?? null,
    },
    ready_to_migrate: readyToMigrate,
    confirm_token: confirmToken,
    post_url: confirmToken
      ? `/api/admin/diagnostics/migrate-legacy-gst?business_id=${businessId}&user_id=<your_user_id>&confirm=${confirmToken}`
      : null,
    notes,
  };
}

// -----------------------------------------------------------------------
// GET: dry-run
// -----------------------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;
    return NextResponse.json(await buildDryRun(auth.businessId));
  } catch (error) {
    const err = error as { message?: string };
    console.error('migrate-legacy-gst GET error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

// -----------------------------------------------------------------------
// POST: execute (requires ?confirm=<token>)
// -----------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const confirm = url.searchParams.get('confirm');
    if (!confirm) {
      return NextResponse.json(
        { error: 'Missing confirm token. Run a GET first to get one.', code: 'CONFIRM_REQUIRED' },
        { status: 400 },
      );
    }

    const dryRun = await buildDryRun(auth.businessId);
    if (!dryRun.ready_to_migrate) {
      return NextResponse.json(
        { error: 'Nothing to migrate or required accounts missing.', dry_run: dryRun },
        { status: 409 },
      );
    }
    if (dryRun.confirm_token !== confirm) {
      return NextResponse.json(
        {
          error: 'Confirm token mismatch — invoice totals or split-account balances changed since dry-run. Re-preview and try again.',
          code: 'TOKEN_MISMATCH',
          expected: dryRun.confirm_token,
          got: confirm,
        },
        { status: 409 },
      );
    }

    const gap = dryRun.gap_to_migrate;
    const acc = dryRun.accounts;

    const sharedRef = `MIGRATE_LEGACY_GST_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
    const narration = 'Phase-3 reclassification: drain pre-split GST out of Sales (4101) into Output CGST/SGST/IGST split accounts.';

    // Generate ONE shared voucher_id so the JV groups together in any voucher viewer.
    const voucherIdRow = await client.query<{ id: string }>('SELECT gen_random_uuid() AS id');
    const sharedVoucherId = voucherIdRow.rows[0].id;

    const inserted: Array<{ account_code: string; debit: number; credit: number }> = [];

    await client.query('BEGIN');

    // Dr Sales (4101) for the FULL gap
    await client.query(
      `INSERT INTO ledger_entry_lines
         (business_id, entry_date, voucher_type, voucher_id, account_id,
          debit, credit, narration, reference_number, branch_id)
       VALUES ($1, NOW()::date, 'journal', $2, $3, $4, 0, $5, $6, NULL)`,
      [auth.businessId, sharedVoucherId, acc.sales!.id, gap.total, narration, sharedRef],
    );
    inserted.push({ account_code: '4101', debit: gap.total, credit: 0 });

    // Cr Output CGST / SGST / IGST / Cess for their gap shares
    if (gap.cgst > 0 && acc.output_cgst) {
      await client.query(
        `INSERT INTO ledger_entry_lines
           (business_id, entry_date, voucher_type, voucher_id, account_id,
            debit, credit, narration, reference_number, branch_id)
         VALUES ($1, NOW()::date, 'journal', $2, $3, 0, $4, $5, $6, NULL)`,
        [auth.businessId, sharedVoucherId, acc.output_cgst.id, gap.cgst, narration, sharedRef],
      );
      inserted.push({ account_code: '2150', debit: 0, credit: gap.cgst });
    }
    if (gap.sgst > 0 && acc.output_sgst) {
      await client.query(
        `INSERT INTO ledger_entry_lines
           (business_id, entry_date, voucher_type, voucher_id, account_id,
            debit, credit, narration, reference_number, branch_id)
         VALUES ($1, NOW()::date, 'journal', $2, $3, 0, $4, $5, $6, NULL)`,
        [auth.businessId, sharedVoucherId, acc.output_sgst.id, gap.sgst, narration, sharedRef],
      );
      inserted.push({ account_code: '2151', debit: 0, credit: gap.sgst });
    }
    if (gap.igst > 0 && acc.output_igst) {
      await client.query(
        `INSERT INTO ledger_entry_lines
           (business_id, entry_date, voucher_type, voucher_id, account_id,
            debit, credit, narration, reference_number, branch_id)
         VALUES ($1, NOW()::date, 'journal', $2, $3, 0, $4, $5, $6, NULL)`,
        [auth.businessId, sharedVoucherId, acc.output_igst.id, gap.igst, narration, sharedRef],
      );
      inserted.push({ account_code: '2152', debit: 0, credit: gap.igst });
    }
    if (gap.cess > 0 && acc.output_cess) {
      await client.query(
        `INSERT INTO ledger_entry_lines
           (business_id, entry_date, voucher_type, voucher_id, account_id,
            debit, credit, narration, reference_number, branch_id)
         VALUES ($1, NOW()::date, 'journal', $2, $3, 0, $4, $5, $6, NULL)`,
        [auth.businessId, sharedVoucherId, acc.output_cess.id, gap.cess, narration, sharedRef],
      );
      inserted.push({ account_code: '2153', debit: 0, credit: gap.cess });
    }

    // Sanity check: must balance
    const totalDr = inserted.reduce((s, x) => s + x.debit, 0);
    const totalCr = inserted.reduce((s, x) => s + x.credit, 0);
    if (Math.abs(totalDr - totalCr) > 0.01) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        {
          error: 'Internal balance check failed — JV would not balance, refusing to commit.',
          totalDr, totalCr, inserted,
        },
        { status: 500 },
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      migrated: true,
      business_id: auth.businessId,
      voucher_id: sharedVoucherId,
      reference: sharedRef,
      narration,
      lines: inserted,
      gap_moved: gap,
      after_state_hint: 'Re-run the validation page to confirm Sales (4101) is reduced and Output GST split accounts are credited.',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const err = error as { message?: string };
    console.error('migrate-legacy-gst POST error:', error);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
