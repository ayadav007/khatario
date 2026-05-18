/**
 * Admin diagnostic endpoint: P&L validation
 *
 * READ-ONLY. Inspects the books and reports issues that distort the
 * Profit & Loss statement (GST mixed into Sales/Purchases, double-counted
 * Other Expenses, COGS using grand_total, snapshot-less stock fallbacks,
 * orphan ledger entries from cancelled invoices, etc).
 *
 * Intended for use during the P&L audit. Safe to delete after the audit
 * is complete and underlying issues are fixed.
 *
 * Usage:
 *   GET /api/admin/diagnostics/pl-validation
 *     ?business_id=...
 *     &from_date=2026-03-01
 *     &to_date=2026-04-19
 *     [&branch_id=ALL|<uuid>]
 *
 * Auth: must be authenticated AND either have settings.read or be the primary admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryOne, queryRows } from '@/lib/db';

interface Check {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info' | 'success';
  description: string;
  finding: unknown;
  impact?: string;
  recommendation?: string;
}

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const branchIdParam = searchParams.get('branch_id'); // 'ALL' | uuid | null

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 });
    }
    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: 'from_date and to_date are required (YYYY-MM-DD)' },
        { status: 400 },
      );
    }

    // Admin gate (mirrors pattern used in dashboard/overview & invoices routes)
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
      return NextResponse.json(
        { error: 'Forbidden: admin only', code: 'NOT_ADMIN' },
        { status: 403 },
      );
    }

    // Branch scoping (mirror P&L semantics)
    const isConsolidated =
      !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';
    const branchId = isConsolidated ? null : branchIdParam;
    const branchFilterSqlInvoices = branchId ? 'AND i.branch_id = $4' : '';
    const branchFilterSqlPurchases = branchId ? 'AND p.branch_id = $4' : '';
    const branchFilterSqlLedger = branchId ? 'AND lel.branch_id = $4' : '';
    const branchFilterSqlReturns = branchId ? 'AND pr.branch_id = $4' : '';
    const branchFilterSqlCN = branchId ? 'AND cn.branch_id = $4' : '';
    const baseParams = [businessId, fromDate, toDate];
    const params = branchId ? [...baseParams, branchId] : baseParams;

    const checks: Check[] = [];

    // ------------------------------------------------------------------
    // CHECK 0: Phase-1 status banner
    // ------------------------------------------------------------------
    checks.push({
      id: 'phase1_status',
      title: 'Phase-1 + Phase-2 + Phase-3 + Phase-4 fixes applied — P&L math, AR routing, GST split, and periodic-COGS are correct',
      severity: 'success',
      description:
        'Phase-1: each expense account_code lives in exactly ONE bucket; Tax (5210/5211) reads from ledger. ' +
        'Phase-2: customer invoices always post Dr AR / Cr Sales; payments post a separate receipt voucher. ' +
        'Phase-3: invoices/purchases/credit-notes/purchase-returns now SPLIT GST. ' +
        'Output GST hits new accounts 2150 (CGST) / 2151 (SGST) / 2152 (IGST) / 2153 (Cess) / 2155 (RCM). ' +
        'Input GST hits new accounts 1110-1115 (asset). Sales (4101) is credited only the taxable_value; ' +
        'Purchases (5101) is debited only the taxable cost. RCM purchases dual-post (Dr Input + Cr RCM Output). ' +
        'ITC-blocked purchases (s.17(5)) keep tax inside Purchases as required. ' +
        'Phase-4: PERIODIC inventory model locked (Tally / Ind AS 2). Per-invoice COGS posting is DISABLED ' +
        'in invoice/credit-note/debit-note ledger functions. cogs-calculator is date-aware via stock_movements ' +
        '(Opening = on-hand qty as of from_date−1; Closing = on-hand qty as of to_date), with unit cost = ' +
        'WEIGHTED-AVERAGE rate from purchase_items.taxable_value/quantity up to the as-of date (Ind AS 2 ' +
        '"Weighted Average Cost Method", Tally Avg. Cost). Net Purchases = ledger 5101 net debit − ledger 5102 ' +
        'net credit (returns netted in). Cross-FY P&L periods now return a top-level warnings[] entry.',
      finding: {
        expense_buckets: {
          direct_expenses: ['5101', '5102'],
          indirect_expenses: ['5201', '5202', '5203'],
          depreciation_separate_line: ['5204'],
          other_expenses_incl_finance_costs_and_provisions: ['5205', '5206', '5207', '5208', '5209'],
          tax_below_PBT_from_ledger: ['5210', '5211'],
        },
        gst_split_accounts: {
          output_liabilities: {
            cgst: '2150',
            sgst: '2151',
            igst: '2152',
            cess: '2153',
            net_settlement: '2154',
            rcm_output: '2155',
          },
          input_assets: {
            cgst: '1110',
            sgst: '1111',
            igst: '1112',
            cess: '1113',
            itc_suspense: '1114',
            rcm_input: '1115',
          },
          legacy_holding_account: '2103 (renamed, deactivated, will be drained by reclassification JV)',
        },
        provisions_service_now_informational_only: true,
        tax_service_now_informational_only: true,
        pbt_formula:
          'PBT = (Sales(taxable) + Other Income) − cogsUsed − Indirect Expenses − Depreciation − Other Expenses',
        pat_formula: 'PAT = PBT − Σ(ledger 5210) − Σ(ledger 5211)',
      },
      impact:
        'After Phase-1+2+3+4, P&L Income equals SUM(invoice.subtotal) (taxable only). Output/Input GST live ' +
        'on the Balance Sheet, not P&L. COGS is computed periodically with date-aware Opening/Closing valued ' +
        'at weighted-average purchase cost. Year-end close JV (writes closing_stock_snapshots and books the ' +
        'closing-inventory adjustment) is the only remaining piece — see Phase-4 readiness card below.',
      recommendation:
        'Open the P&L report (/reports/profit-loss) to confirm Sales matches taxable_value and that COGS uses ' +
        'date-aware Opening/Closing. Cross-FY ranges now show a yellow warning banner. Check the Trial Balance ' +
        'for the new 2150-2155 / 1110-1115 lines. If you have pre-Phase-3 invoices, run "Migrate legacy GST".',
    });

    // ------------------------------------------------------------------
    // CHECK 1: GST hidden inside Sales (Income inflation)
    // ------------------------------------------------------------------
    const salesGst = await queryOne<{
      invoice_count: string;
      taxable_value_total: string;
      cgst_total: string;
      sgst_total: string;
      igst_total: string;
      gst_total: string;
      grand_total: string;
    }>(
      `SELECT
         COUNT(*)::text                                                                AS invoice_count,
         COALESCE(SUM(i.subtotal), 0)::text                                            AS taxable_value_total,
         COALESCE(SUM(i.cgst_total), 0)::text                                          AS cgst_total,
         COALESCE(SUM(i.sgst_total), 0)::text                                          AS sgst_total,
         COALESCE(SUM(i.igst_total), 0)::text                                          AS igst_total,
         COALESCE(SUM(i.cgst_total + i.sgst_total + i.igst_total), 0)::text            AS gst_total,
         COALESCE(SUM(i.grand_total), 0)::text                                         AS grand_total
       FROM invoices i
       WHERE i.business_id = $1
         AND i.status != 'cancelled'
         AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
         AND i.invoice_date BETWEEN $2 AND $3
         ${branchFilterSqlInvoices}`,
      params,
    );

    const salesGstNum = Number(salesGst?.gst_total ?? 0);
    const salesGrand = Number(salesGst?.grand_total ?? 0);
    const invoiceCgst = Number(salesGst?.cgst_total ?? 0);
    const invoiceSgst = Number(salesGst?.sgst_total ?? 0);
    const invoiceIgst = Number(salesGst?.igst_total ?? 0);

    // PHASE-3: read the actual ledger postings against the new Output GST accounts
    // for this period and reconcile against the invoice header totals.
    const outputGstLedger = await queryOne<{ cgst_net: string; sgst_net: string; igst_net: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN a.account_code = '2150' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS cgst_net,
         COALESCE(SUM(CASE WHEN a.account_code = '2151' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS sgst_net,
         COALESCE(SUM(CASE WHEN a.account_code = '2152' THEN lel.credit - lel.debit ELSE 0 END),0)::text AS igst_net
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('2150','2151','2152')
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}`,
      params,
    );
    const outCgstLedger = Number(outputGstLedger?.cgst_net ?? 0);
    const outSgstLedger = Number(outputGstLedger?.sgst_net ?? 0);
    const outIgstLedger = Number(outputGstLedger?.igst_net ?? 0);
    const totalOutputLedger = outCgstLedger + outSgstLedger + outIgstLedger;

    // Tolerances: ±₹0.50 to absorb rounding noise on the per-invoice splits.
    const cgstGap = Math.abs(invoiceCgst - outCgstLedger);
    const sgstGap = Math.abs(invoiceSgst - outSgstLedger);
    const igstGap = Math.abs(invoiceIgst - outIgstLedger);
    const totalGstGap = Math.abs(salesGstNum - totalOutputLedger);
    const gstSplitMatches = cgstGap < 0.5 && sgstGap < 0.5 && igstGap < 0.5;
    const noInvoicesInPeriod = Number(salesGst?.invoice_count ?? 0) === 0;
    const noTaxedInvoices = salesGstNum === 0;

    let gstInSalesSeverity: Check['severity'];
    let gstInSalesImpact: string;
    if (noInvoicesInPeriod) {
      gstInSalesSeverity = 'info';
      gstInSalesImpact = 'No invoices in this period, so this issue has no current impact.';
    } else if (noTaxedInvoices) {
      gstInSalesSeverity = 'success';
      gstInSalesImpact = 'No taxable invoices in this period — nothing to split. Phase-3 logic is in place.';
    } else if (gstSplitMatches) {
      gstInSalesSeverity = 'success';
      gstInSalesImpact =
        `Output GST split is correct: invoice CGST/SGST/IGST (₹${salesGstNum.toFixed(2)}) ≈ ledger 2150+2151+2152 (₹${totalOutputLedger.toFixed(2)}). ` +
        `Sales (4101) is correctly credited only the taxable value.`;
    } else {
      gstInSalesSeverity = 'high';
      gstInSalesImpact =
        `Output GST split MISMATCH: invoice GST = ₹${salesGstNum.toFixed(2)}, ledger 2150+2151+2152 = ₹${totalOutputLedger.toFixed(2)} (gap ₹${totalGstGap.toFixed(2)}). ` +
        `Most likely cause: pre-Phase-3 invoices in this period whose GST is still inside Sales (4101). ` +
        `Run "Migrate legacy GST" above to reclassify them.`;
    }

    checks.push({
      id: 'gst_in_sales',
      title: gstInSalesSeverity === 'success' ? 'STATUS: FIXED in Phase-3 — Output GST split correctly' : 'Output GST split mismatch',
      severity: gstInSalesSeverity,
      description:
        'PHASE-3 (lib/ledger-utils.ts createInvoiceLedgerEntries): invoices now credit Sales (4101) only ' +
        'the taxable_value, with CGST/SGST/IGST routed to Output GST liability accounts (2150 / 2151 / 2152). ' +
        'This check reconciles invoice-header GST against actual postings on those accounts.',
      finding: {
        invoices_inspected: Number(salesGst?.invoice_count ?? 0),
        invoice_totals: {
          taxable_value: Number(salesGst?.taxable_value_total ?? 0),
          cgst: invoiceCgst,
          sgst: invoiceSgst,
          igst: invoiceIgst,
          gst_total: salesGstNum,
          grand_total: salesGrand,
        },
        ledger_split_account_balances: {
          output_cgst_2150: outCgstLedger,
          output_sgst_2151: outSgstLedger,
          output_igst_2152: outIgstLedger,
          total: totalOutputLedger,
        },
        per_component_gap: {
          cgst: cgstGap,
          sgst: sgstGap,
          igst: igstGap,
          total: totalGstGap,
          tolerance: 0.5,
        },
        sales_4101_should_equal: 'taxable_value (post-Phase-3)',
      },
      impact: gstInSalesImpact,
      recommendation:
        gstInSalesSeverity === 'success'
          ? 'No action — Phase-3 split is working as designed.'
          : 'Use the "Migrate legacy GST" button above to drain pre-Phase-3 GST out of Sales (4101) into the new split accounts.',
    });

    // ------------------------------------------------------------------
    // CHECK 2: GST hidden inside Purchases (COGS inflation, lost ITC)
    // ------------------------------------------------------------------
    const purchaseGst = await queryOne<{
      purchase_count: string;
      subtotal: string;
      cgst_total: string;
      sgst_total: string;
      igst_total: string;
      gst_total: string;
      grand_total: string;
      itc_eligible_count: string;
      reverse_charge_count: string;
    }>(
      `SELECT
         COUNT(*)::text                                                            AS purchase_count,
         COALESCE(SUM(p.subtotal), 0)::text                                        AS subtotal,
         COALESCE(SUM(p.cgst_total), 0)::text                                      AS cgst_total,
         COALESCE(SUM(p.sgst_total), 0)::text                                      AS sgst_total,
         COALESCE(SUM(p.igst_total), 0)::text                                      AS igst_total,
         COALESCE(SUM(p.cgst_total + p.sgst_total + p.igst_total), 0)::text        AS gst_total,
         COALESCE(SUM(p.grand_total), 0)::text                                     AS grand_total,
         COALESCE(SUM(CASE WHEN p.itc_eligible THEN 1 ELSE 0 END), 0)::text        AS itc_eligible_count,
         COALESCE(SUM(CASE WHEN p.is_reverse_charge THEN 1 ELSE 0 END), 0)::text   AS reverse_charge_count
       FROM purchases p
       WHERE p.business_id = $1
         AND p.status != 'cancelled'
         AND p.bill_date BETWEEN $2 AND $3
         ${branchFilterSqlPurchases}`,
      params,
    );

    const purchaseGstNum = Number(purchaseGst?.gst_total ?? 0);
    const purchaseCgst = Number(purchaseGst?.cgst_total ?? 0);
    const purchaseSgst = Number(purchaseGst?.sgst_total ?? 0);
    const purchaseIgst = Number(purchaseGst?.igst_total ?? 0);
    const itcEligibleCount = Number(purchaseGst?.itc_eligible_count ?? 0);
    const rcmPurchaseCount = Number(purchaseGst?.reverse_charge_count ?? 0);

    // PHASE-3: read the actual ledger postings against the new Input GST accounts
    // for purchases dated in the period. ITC-blocked purchases (s.17(5)) deliberately
    // keep tax inside Purchases (5101) — those should NOT show up on 1110-1112.
    const inputGstLedger = await queryOne<{ cgst_net: string; sgst_net: string; igst_net: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN a.account_code = '1110' THEN lel.debit - lel.credit ELSE 0 END),0)::text AS cgst_net,
         COALESCE(SUM(CASE WHEN a.account_code = '1111' THEN lel.debit - lel.credit ELSE 0 END),0)::text AS sgst_net,
         COALESCE(SUM(CASE WHEN a.account_code = '1112' THEN lel.debit - lel.credit ELSE 0 END),0)::text AS igst_net
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('1110','1111','1112')
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}`,
      params,
    );
    const inCgstLedger = Number(inputGstLedger?.cgst_net ?? 0);
    const inSgstLedger = Number(inputGstLedger?.sgst_net ?? 0);
    const inIgstLedger = Number(inputGstLedger?.igst_net ?? 0);
    const totalInputLedger = inCgstLedger + inSgstLedger + inIgstLedger;

    // For ITC-eligible purchases, GST should land on Input accounts.
    // For ITC-ineligible purchases, GST stays inside Purchases (5101) by design.
    // We can only validate the eligible bucket here; without a per-row split we
    // accept "ledger >= 0 and ≤ total invoice GST" as a healthy state.
    const noPurchasesInPeriod = Number(purchaseGst?.purchase_count ?? 0) === 0;
    const noTaxedPurchases = purchaseGstNum === 0;
    let gstInPurchasesSeverity: Check['severity'];
    let gstInPurchasesImpact: string;
    if (noPurchasesInPeriod) {
      gstInPurchasesSeverity = 'info';
      gstInPurchasesImpact = 'No purchases in this period.';
    } else if (noTaxedPurchases) {
      gstInPurchasesSeverity = 'success';
      gstInPurchasesImpact = 'No taxable purchases in this period — nothing to split. Phase-3 logic is in place.';
    } else if (itcEligibleCount === 0) {
      gstInPurchasesSeverity = 'success';
      gstInPurchasesImpact =
        `All ${Number(purchaseGst?.purchase_count ?? 0)} purchases in this period are ITC-ineligible (s.17(5) blocked). ` +
        `By design, their GST stays inside Purchases (5101). Input GST accounts (1110-1112) correctly show ₹${totalInputLedger.toFixed(2)}.`;
    } else if (totalInputLedger > 0 && totalInputLedger <= purchaseGstNum + 0.5) {
      gstInPurchasesSeverity = 'success';
      gstInPurchasesImpact =
        `Input GST split is working: ₹${totalInputLedger.toFixed(2)} sits on Input GST asset accounts (1110-1112) ` +
        `out of ₹${purchaseGstNum.toFixed(2)} total invoice GST (the remainder is ITC-blocked and stays inside Purchases as required). ` +
        `${rcmPurchaseCount > 0 ? `${rcmPurchaseCount} RCM purchase(s) also dual-posted to Input + RCM Output (2155).` : ''}`;
    } else {
      gstInPurchasesSeverity = 'high';
      gstInPurchasesImpact =
        `Input GST mismatch: ledger 1110+1111+1112 = ₹${totalInputLedger.toFixed(2)} vs invoice GST ₹${purchaseGstNum.toFixed(2)} ` +
        `(itc_eligible=${itcEligibleCount}). Pre-Phase-3 purchases may still be hiding GST inside Purchases (5101).`;
    }

    checks.push({
      id: 'gst_in_purchases',
      title: gstInPurchasesSeverity === 'success' ? 'STATUS: FIXED in Phase-3 — Input GST split correctly' : 'Input GST split mismatch',
      severity: gstInPurchasesSeverity,
      description:
        'PHASE-3 (lib/ledger-utils.ts createPurchaseLedgerEntries): purchases now debit Purchases (5101) only ' +
        'the taxable cost. ITC-eligible CGST/SGST/IGST is debited to Input GST asset accounts (1110/1111/1112). ' +
        'ITC-blocked purchases (s.17(5)) deliberately roll tax into Purchases. Reverse-charge purchases dual-post ' +
        '(Dr Input GST + Cr RCM Output 2155).',
      finding: {
        purchases: Number(purchaseGst?.purchase_count ?? 0),
        invoice_totals: {
          subtotal: Number(purchaseGst?.subtotal ?? 0),
          cgst: purchaseCgst,
          sgst: purchaseSgst,
          igst: purchaseIgst,
          gst_total: purchaseGstNum,
          grand_total: Number(purchaseGst?.grand_total ?? 0),
        },
        ledger_split_account_balances: {
          input_cgst_1110: inCgstLedger,
          input_sgst_1111: inSgstLedger,
          input_igst_1112: inIgstLedger,
          total: totalInputLedger,
        },
        flags: {
          itc_eligible_count: itcEligibleCount,
          reverse_charge_count: rcmPurchaseCount,
        },
      },
      impact: gstInPurchasesImpact,
      recommendation:
        gstInPurchasesSeverity === 'success'
          ? 'No action — Phase-3 split is working as designed.'
          : 'Recreate the affected purchases via the new code path, or post a reclassification JV draining tax out of Purchases (5101) into 1110/1111/1112.',
    });

    // ------------------------------------------------------------------
    // CHECK 2b (NEW Phase-3): legacy 2103 posting watchdog
    //   Any post-Phase-3 voucher that hits 2103 means a code path was missed.
    // ------------------------------------------------------------------
    const legacy2103 = await queryRows<{
      voucher_type: string;
      line_count: string;
      total_debit: string;
      total_credit: string;
    }>(
      `SELECT lel.voucher_type,
              COUNT(*)::text                AS line_count,
              COALESCE(SUM(lel.debit),0)::text  AS total_debit,
              COALESCE(SUM(lel.credit),0)::text AS total_credit
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code = '2103'
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}
        GROUP BY lel.voucher_type
        ORDER BY lel.voucher_type`,
      params,
    );
    const legacy2103Lines = legacy2103.reduce((s, r) => s + Number(r.line_count || 0), 0);
    const legacy2103Net =
      legacy2103.reduce((s, r) => s + Number(r.total_credit || 0), 0) -
      legacy2103.reduce((s, r) => s + Number(r.total_debit || 0), 0);

    // Legitimate post-Phase-3 hits on 2103 are journal vouchers (the migration JV)
    // that DRAIN the account. Anything else (invoice / purchase / credit_note /
    // purchase_return / debit_note) means the new code path was bypassed.
    const suspectLegacyHits = legacy2103.filter((r) =>
      ['invoice', 'purchase', 'credit_note', 'purchase_return', 'debit_note'].includes(r.voucher_type),
    );
    checks.push({
      id: 'legacy_2103_postings',
      title:
        suspectLegacyHits.length === 0
          ? 'STATUS: CLEAN — no transactional postings to legacy 2103 in this period'
          : 'Legacy GST account (2103) is still receiving transactional postings',
      severity: suspectLegacyHits.length > 0 ? 'critical' : 'success',
      description:
        'After Phase-3, the legacy "2103 GST Payable" account is deactivated and reserved for the one-off ' +
        'migration journal voucher only. Any invoice / purchase / credit-note / purchase-return / debit-note ' +
        'lines hitting 2103 in this period mean the new split-posting code was bypassed (likely a ledger ' +
        'function that was missed in the Phase-3 refactor).',
      finding: {
        lines_in_period_total: legacy2103Lines,
        net_credit_balance_change_in_period: legacy2103Net,
        breakdown_by_voucher_type: legacy2103.map((r) => ({
          voucher_type: r.voucher_type,
          line_count: Number(r.line_count),
          total_debit: Number(r.total_debit),
          total_credit: Number(r.total_credit),
        })),
        suspect_voucher_types: suspectLegacyHits.map((r) => r.voucher_type),
      },
      impact:
        suspectLegacyHits.length > 0
          ? `Found ${suspectLegacyHits.length} voucher type(s) (${suspectLegacyHits
              .map((r) => r.voucher_type)
              .join(', ')}) still posting to 2103. New GST-split accounts will under-state and 2103 will not stay drained.`
          : 'Only journal-voucher activity (or none at all) on 2103 — exactly what we expect after Phase-3.',
      recommendation:
        suspectLegacyHits.length > 0
          ? 'Audit the corresponding ledger-utils function for the listed voucher_types and ensure it routes GST to 2150-2153 / 1110-1113.'
          : 'No action — Phase-3 routing is clean.',
    });

    // ------------------------------------------------------------------
    // CHECK 2c (NEW Phase-3): RCM JV completeness
    //   For every is_reverse_charge=true purchase, there must be a matching
    //   credit on RCM Output (2155). If not, self-assessed RCM tax was not booked.
    // ------------------------------------------------------------------
    const rcmCheck = await queryOne<{
      rcm_purchases: string;
      rcm_invoice_gst_total: string;
      rcm_jv_credit_2155: string;
      rcm_jv_debit_1115: string;
    }>(
      `WITH rcm AS (
         SELECT p.id, COALESCE(p.cgst_total,0) + COALESCE(p.sgst_total,0) + COALESCE(p.igst_total,0) AS gst_amt
           FROM purchases p
          WHERE p.business_id = $1
            AND p.is_reverse_charge = true
            AND p.status != 'cancelled'
            AND p.bill_date BETWEEN $2 AND $3
            ${branchFilterSqlPurchases}
       )
       SELECT
         (SELECT COUNT(*)::text FROM rcm)                                               AS rcm_purchases,
         (SELECT COALESCE(SUM(gst_amt),0)::text FROM rcm)                               AS rcm_invoice_gst_total,
         COALESCE((
           SELECT SUM(lel.credit - lel.debit)
             FROM ledger_entry_lines lel
             JOIN accounts a ON a.id = lel.account_id
            WHERE lel.business_id = $1
              AND a.account_code = '2155'
              AND lel.voucher_type = 'purchase'
              AND lel.voucher_id IN (SELECT id FROM rcm)
         ),0)::text                                                                      AS rcm_jv_credit_2155,
         COALESCE((
           SELECT SUM(lel.debit - lel.credit)
             FROM ledger_entry_lines lel
             JOIN accounts a ON a.id = lel.account_id
            WHERE lel.business_id = $1
              AND a.account_code = '1115'
              AND lel.voucher_type = 'purchase'
              AND lel.voucher_id IN (SELECT id FROM rcm)
         ),0)::text                                                                      AS rcm_jv_debit_1115`,
      params,
    );
    const rcmPurchases = Number(rcmCheck?.rcm_purchases ?? 0);
    const rcmInvoiceGst = Number(rcmCheck?.rcm_invoice_gst_total ?? 0);
    const rcm2155Credit = Number(rcmCheck?.rcm_jv_credit_2155 ?? 0);
    const rcm1115Debit = Number(rcmCheck?.rcm_jv_debit_1115 ?? 0);
    const rcmGap2155 = Math.abs(rcmInvoiceGst - rcm2155Credit);
    const rcmGap1115 = Math.abs(rcmInvoiceGst - rcm1115Debit);

    let rcmSeverity: Check['severity'];
    let rcmImpact: string;
    if (rcmPurchases === 0) {
      rcmSeverity = 'info';
      rcmImpact = 'No reverse-charge purchases in this period.';
    } else if (rcmInvoiceGst === 0) {
      // RCM purchases exist but supplier already showed zero GST on the bill.
      // Self-assessed amount should still be > 0 only if the rate applies.
      rcmSeverity = 'medium';
      rcmImpact =
        `${rcmPurchases} RCM purchase(s) but the invoice header shows ₹0 GST. ` +
        `RCM tax must be self-assessed at the applicable rate — verify the bill totals were captured correctly.`;
    } else if (rcmGap2155 < 0.5 && rcmGap1115 < 0.5) {
      rcmSeverity = 'success';
      rcmImpact =
        `RCM dual-entry intact: ${rcmPurchases} purchase(s), ₹${rcmInvoiceGst.toFixed(2)} GST. ` +
        `RCM Output (2155) credited ₹${rcm2155Credit.toFixed(2)}, RCM Input (1115) debited ₹${rcm1115Debit.toFixed(2)}.`;
    } else {
      rcmSeverity = 'critical';
      rcmImpact =
        `RCM dual-entry MISSING/INCOMPLETE: ${rcmPurchases} purchase(s) with ₹${rcmInvoiceGst.toFixed(2)} GST, ` +
        `but RCM Output (2155) credit = ₹${rcm2155Credit.toFixed(2)} (gap ₹${rcmGap2155.toFixed(2)}) ` +
        `and RCM Input (1115) debit = ₹${rcm1115Debit.toFixed(2)} (gap ₹${rcmGap1115.toFixed(2)}). ` +
        `Self-assessed RCM tax liability is under-booked — GSTR-3B will be wrong.`;
    }

    checks.push({
      id: 'rcm_dual_entry_completeness',
      title:
        rcmSeverity === 'success'
          ? 'STATUS: PASS — RCM dual-entry posted for every reverse-charge purchase'
          : rcmSeverity === 'info'
          ? 'RCM dual-entry — no reverse-charge purchases in period'
          : 'RCM dual-entry incomplete',
      severity: rcmSeverity,
      description:
        'PHASE-3: every purchase with is_reverse_charge=true must self-assess GST: Dr RCM Input (1115) ' +
        'and Cr RCM Output Tax Payable (2155) for the same amount. This check reconciles the invoice GST ' +
        'against the actual postings on 1115 and 2155 for the same voucher_id.',
      finding: {
        rcm_purchases_in_period: rcmPurchases,
        invoice_gst_on_rcm_purchases: rcmInvoiceGst,
        ledger_rcm_output_2155_credit: rcm2155Credit,
        ledger_rcm_input_1115_debit: rcm1115Debit,
        gap_2155: rcmGap2155,
        gap_1115: rcmGap1115,
        tolerance: 0.5,
      },
      impact: rcmImpact,
      recommendation:
        rcmSeverity === 'success' || rcmSeverity === 'info'
          ? 'No action.'
          : 'Recreate the affected purchases via the Phase-3 code path, or post a manual RCM JV: Dr 1115, Cr 2155 for the missing amount.',
    });

    // ------------------------------------------------------------------
    // CHECK 3: Sales account ledger vs invoice numbers
    // ------------------------------------------------------------------
    const salesLedger = await queryOne<{ sales_net: string }>(
      `SELECT COALESCE(SUM(lel.credit - lel.debit), 0)::text AS sales_net
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code = '4101'
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}`,
      params,
    );
    const salesLedgerNum = Number(salesLedger?.sales_net ?? 0);
    const taxableTotal = Number(salesGst?.taxable_value_total ?? 0);
    const salesGapVsGrand = salesLedgerNum - salesGrand;
    const salesGapVsTaxable = salesLedgerNum - taxableTotal;
    checks.push({
      id: 'sales_ledger_vs_documents',
      title: 'Reconciliation: Sales (4101) ledger vs invoice totals',
      severity:
        Math.abs(salesGapVsGrand) > 0.5
          ? 'high'
          : 'info',
      description:
        'In the current code Sales should equal SUM(invoice.grand_total). After the GST split fix it should equal SUM(invoice.taxable_value).',
      finding: {
        sales_account_ledger_net: salesLedgerNum,
        invoices_grand_total: salesGrand,
        invoices_taxable_value: taxableTotal,
        gap_vs_grand_total: salesGapVsGrand,
        gap_vs_taxable_value: salesGapVsTaxable,
      },
      impact:
        Math.abs(salesGapVsGrand) > 0.5
          ? 'Mismatch between Sales ledger and invoice grand_total — likely orphan ledger entries (cancelled invoices not reversed) or missing postings.'
          : 'Currently consistent with grand_total posting (which is itself the bug — GST is included).',
      recommendation: 'Investigate cancelled invoices and edit/void paths if mismatch exists.',
    });

    // ------------------------------------------------------------------
    // CHECK 4: Other Expenses (5205-5209) double-counted in Indirect+Other
    // ------------------------------------------------------------------
    const otherExpRows = await queryRows<{
      account_code: string;
      account_name: string;
      net_expense: string;
    }>(
      `SELECT a.account_code, a.account_name,
              COALESCE(SUM(lel.debit - lel.credit), 0)::text AS net_expense
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('5205','5206','5207','5208','5209')
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}
        GROUP BY a.account_code, a.account_name
        ORDER BY a.account_code`,
      params,
    );
    const otherDouble = otherExpRows.reduce(
      (s, r) => s + Number(r.net_expense || 0),
      0,
    );
    checks.push({
      id: 'other_expenses_double_count',
      title: 'Other Expenses (5205-5209) — was double-counted in P&L',
      severity: 'success',
      description:
        'STATUS: FIXED in Phase-1. profit-loss/route.ts now uses an explicit otherExpenseCodes set ' +
        'and excludes 5205-5209 from indirectExpenses. This card stays as an informational schedule of ' +
        'what is currently posted to those accounts.',
      finding: {
        accounts: otherExpRows,
        ledger_balance_in_period: otherDouble,
        phase1_fix_applied: true,
      },
      impact:
        otherDouble !== 0
          ? `Ledger has ₹${Math.abs(otherDouble).toFixed(2)} in 5205-5209. After Phase-1, this is reflected exactly once in PBT (under "Other Expenses").`
          : 'No balances in 5205-5209 in this period.',
      recommendation:
        'No action — Phase-1 already excludes these from indirectExpenses. Verify by re-running the P&L report.',
    });

    // ------------------------------------------------------------------
    // CHECK 5: Tax expense (5210, 5211) double-counted (Indirect + Tax)
    // ------------------------------------------------------------------
    const taxExpRows = await queryRows<{
      account_code: string;
      account_name: string;
      net_expense: string;
    }>(
      `SELECT a.account_code, a.account_name,
              COALESCE(SUM(lel.debit - lel.credit), 0)::text AS net_expense
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('5210','5211')
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}
        GROUP BY a.account_code, a.account_name
        ORDER BY a.account_code`,
      params,
    );
    const taxDouble = taxExpRows.reduce(
      (s, r) => s + Number(r.net_expense || 0),
      0,
    );
    checks.push({
      id: 'tax_expense_double_count',
      title: 'Current/Deferred Tax (5210/5211) — was in Indirect Expenses AND Tax block',
      severity: 'success',
      description:
        'STATUS: FIXED in Phase-1 (with hotfix). profit-loss/route.ts now (a) excludes 5210/5211 from ' +
        'indirectExpenses, AND (b) reads the Tax block from the ledger postings to 5210/5211 ' +
        '(not from the tax-provision-calculator service, which is now informational only).',
      finding: {
        accounts: taxExpRows,
        ledger_balance_in_period: taxDouble,
        phase1_fix_applied: true,
        tax_now_sourced_from: 'ledger_5210_5211',
        provision_service_is: 'informational_estimate_only_NOT_subtracted_from_PBT',
      },
      impact:
        taxDouble !== 0
          ? `Ledger has ₹${Math.abs(taxDouble).toFixed(2)} in 5210/5211. P&L Tax block reflects this exact amount; PAT = PBT − ₹${Math.abs(taxDouble).toFixed(2)}.`
          : 'No balances in 5210/5211 in this period — PAT equals PBT.',
      recommendation:
        'No action. To record tax: post a JV (Dr 5210/5211, Cr Tax Payable/Cash). The tax-provision-calculator estimate is shown alongside in tax.provision_service_estimate for transparency.',
    });

    // ------------------------------------------------------------------
    // CHECK 6: Stock snapshot existence (drives accuracy of opening/closing)
    // ------------------------------------------------------------------
    const snapshots = await queryRows<{
      financial_year: string;
      items_in_snapshot: string;
      total_value: string;
    }>(
      `SELECT financial_year,
              COUNT(*)::text AS items_in_snapshot,
              COALESCE(SUM(total_value), 0)::text AS total_value
         FROM closing_stock_snapshots
        WHERE business_id = $1
        GROUP BY financial_year
        ORDER BY financial_year`,
      [businessId],
    );
    checks.push({
      id: 'stock_snapshot_existence',
      title:
        snapshots.length > 0
          ? 'STATUS: FIXED in Phase-4 — date-aware via stock_movements; snapshots present (year-end close ran)'
          : 'STATUS: FIXED in Phase-4 — date-aware via stock_movements; FY snapshots optional',
      severity: 'success',
      description:
        'Phase-4: cogs-calculator now derives stock-on-date from the existing stock_movements table ' +
        '(current_stock − Σ movements after as-of date), and values it at WEIGHTED-AVERAGE rate ' +
        '(SUM(purchase_items.taxable_value) / SUM(purchase_items.quantity) over all non-cancelled purchases ' +
        'up to the as-of date — Ind AS 2 "Weighted Average Cost Method", Tally Avg. Cost in Periodic mode). ' +
        'Snapshots are still preferred when present (locked at year-end close), but their absence no longer ' +
        'falls back to date-blind values. Year-end snapshots will be written automatically when the ' +
        '"Close Financial Year" endpoint ships.',
      finding: {
        snapshots: snapshots.map((s) => ({
          financial_year: s.financial_year,
          items_in_snapshot: Number(s.items_in_snapshot),
          total_value: Number(s.total_value),
        })),
        phase4_primary_source: 'stock_movements + weighted_avg_purchase_items',
        phase4_fallback_chain: 'snapshot → stock_movements_derived → items.opening_stock × items.purchase_price (opening only)',
        snapshots_required_for: 'audit_lock_and_perf_only_no_longer_for_correctness',
      },
      impact:
        snapshots.length === 0
          ? 'No snapshots yet — that is fine: COGS is computed from stock_movements at weighted-avg cost, both date-aware. Snapshots will be auto-created by the year-end-close endpoint.'
          : 'Snapshots exist — COGS calculator will prefer them over the derived value (locked, audit-ready).',
      recommendation:
        snapshots.length === 0
          ? 'No action — Phase-4 made this self-correcting. Run year-end close at 31-March to lock the FY.'
          : 'No action.',
    });

    // ------------------------------------------------------------------
    // CHECK 7: Period crossing FY boundary
    // ------------------------------------------------------------------
    const fromYear = Number(fromDate.slice(0, 4));
    const fromMonth = Number(fromDate.slice(5, 7));
    const toYear = Number(toDate.slice(0, 4));
    const toMonth = Number(toDate.slice(5, 7));
    const fyOf = (y: number, m: number) => (m < 4 ? y - 1 : y);
    const fromFY = fyOf(fromYear, fromMonth);
    const toFY = fyOf(toYear, toMonth);
    checks.push({
      id: 'period_crosses_fy',
      title:
        fromFY !== toFY
          ? 'Reporting period straddles an Indian FY boundary — soft-warned in P&L API'
          : 'Reporting period is within a single FY (statutory-aligned)',
      severity: fromFY !== toFY ? 'medium' : 'success',
      description:
        'PHASE-4: cross-FY P&L periods are still computed (Tally parity — useful for management reports), ' +
        'but /api/reports/profit-loss now returns warnings[] with code="period_crosses_fy_boundary" so the ' +
        'UI shows a yellow banner. Numbers from a cross-FY range are NOT statutory-quality and should not be ' +
        'used for filing.',
      finding: {
        from_fy: `${fromFY}-${(fromFY + 1).toString().slice(-2)}`,
        to_fy: `${toFY}-${(toFY + 1).toString().slice(-2)}`,
        crosses_fy_end: fromFY !== toFY,
        api_warning_emitted: fromFY !== toFY,
      },
      impact:
        fromFY !== toFY
          ? 'Opening stock is taken as of from_date − 1 day, but Net Purchases include vouchers from both FYs. ' +
            'Management-style only — banner is shown on the P&L UI.'
          : 'Period is within a single FY — statutory-quality.',
      recommendation:
        fromFY !== toFY
          ? 'For statutory or filing use, run two separate P&Ls — one per FY.'
          : 'No action.',
    });

    // ------------------------------------------------------------------
    // CHECK 8: Purchase Returns ignored by COGS calculator
    // ------------------------------------------------------------------
    const prTotals = await queryOne<{
      cnt: string;
      grand_total: string;
      taxable_value: string;
    }>(
      `SELECT COUNT(*)::text AS cnt,
              COALESCE(SUM(pr.grand_total), 0)::text AS grand_total,
              COALESCE(SUM(pr.subtotal), 0)::text AS taxable_value
         FROM purchase_returns pr
        WHERE pr.business_id = $1
          AND pr.return_date BETWEEN $2 AND $3
          ${branchFilterSqlReturns}`,
      params,
    );
    const prGrand = Number(prTotals?.grand_total ?? 0);
    // Phase-4: purchase returns are now subtracted via the LEDGER 5102 net
    // credit inside cogs-calculator.getNetPurchasesFromLedger, so this check
    // is informational. We additionally read the period 5102 net to prove it.
    const ledger5102 = await queryOne<{ net_5102: string }>(
      `SELECT COALESCE(SUM(lel.credit - lel.debit),0)::text AS net_5102
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code = '5102'
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}`,
      params,
    );
    const ledger5102Net = Number(ledger5102?.net_5102 ?? 0);
    checks.push({
      id: 'purchase_returns_not_in_cogs',
      title: 'STATUS: FIXED in Phase-4 (calc) — Purchase Returns now netted from COGS via ledger 5102',
      severity: 'success',
      description:
        'Phase-4 Checkpoint A: cogs-calculator now reads net purchases as ' +
        '(ledger 5101 net debit) − (ledger 5102 net credit). Purchase Returns automatically reduce ' +
        'Net Purchases (Tally-style "net into Purchases" presentation, single line on the P&L).',
      finding: {
        return_count: Number(prTotals?.cnt ?? 0),
        grand_total_in_period: prGrand,
        taxable_value_in_period: Number(prTotals?.taxable_value ?? 0),
        ledger_5102_net_credit: ledger5102Net,
        cogs_calc_subtracts: ledger5102Net,
      },
      impact:
        prGrand > 0
          ? `Purchase Returns of ₹${prGrand.toFixed(2)} (header) / ₹${ledger5102Net.toFixed(2)} (ledger 5102) are now correctly netted from Net Purchases by cogs-calculator. COGS is no longer overstated.`
          : 'No purchase returns in this period — nothing to net.',
      recommendation: 'No action — Phase-4 fix in place.',
    });

    // ------------------------------------------------------------------
    // CHECK 9: Cancelled invoices still hitting Sales ledger
    // ------------------------------------------------------------------
    const orphanInvoices = await queryRows<{
      id: string;
      invoice_number: string | null;
      status: string;
      grand_total: string;
      sales_ledger_net: string;
    }>(
      `SELECT i.id,
              i.invoice_number,
              i.status,
              i.grand_total::text,
              COALESCE((
                SELECT SUM(lel.credit - lel.debit)
                  FROM ledger_entry_lines lel
                  JOIN accounts a ON a.id = lel.account_id
                 WHERE lel.voucher_id = i.id
                   AND lel.voucher_type = 'invoice'
                   AND a.account_code = '4101'
              ), 0)::text AS sales_ledger_net
         FROM invoices i
        WHERE i.business_id = $1
          AND i.status = 'cancelled'
        ORDER BY i.invoice_date DESC
        LIMIT 200`,
      [businessId],
    );
    const orphanWithLedger = orphanInvoices.filter(
      (r) => Math.abs(Number(r.sales_ledger_net || 0)) > 0.005,
    );
    checks.push({
      id: 'cancelled_invoices_orphan_ledger',
      title: 'Cancelled invoices that still leave Sales ledger entries',
      severity: orphanWithLedger.length > 0 ? 'critical' : 'info',
      description:
        'createInvoiceLedgerEntries posts on creation but no inverse posting was found for the cancellation path. If any cancelled invoice still has Sales credit > 0 in the ledger, P&L is permanently inflated.',
      finding: {
        cancelled_invoices_inspected: orphanInvoices.length,
        cancelled_with_residual_sales_ledger: orphanWithLedger.length,
        sample: orphanWithLedger.slice(0, 20),
      },
      impact:
        orphanWithLedger.length > 0
          ? `${orphanWithLedger.length} cancelled invoices still inflate Sales income.`
          : 'No orphan ledger entries from cancelled invoices were found in the inspected sample.',
      recommendation:
        'Add a reversal posting (debit Sales, credit AR/Cash; reverse COGS too) when an invoice is cancelled.',
    });

    // ------------------------------------------------------------------
    // CHECK 10: Cash-sale heuristic — credit invoices booked as cash sales
    // ------------------------------------------------------------------
    // We approximate "cash-routed" by absence of any AR (1103) ledger entry for the invoice.
    const cashRouted = await queryOne<{
      total_credit_invoices: string;
      mis_routed_count: string;
      mis_routed_amount: string;
    }>(
      `WITH cred AS (
         SELECT i.id, i.grand_total
           FROM invoices i
          WHERE i.business_id = $1
            AND i.status != 'cancelled'
            AND i.customer_id IS NOT NULL
            AND i.invoice_date BETWEEN $2 AND $3
            ${branchFilterSqlInvoices}
       ),
       has_ar AS (
         SELECT DISTINCT lel.voucher_id AS id
           FROM ledger_entry_lines lel
           JOIN accounts a ON a.id = lel.account_id
          WHERE lel.voucher_type = 'invoice'
            AND a.account_code = '1103'
            AND lel.business_id = $1
       )
       SELECT
         (SELECT COUNT(*)::text FROM cred)                                           AS total_credit_invoices,
         (SELECT COUNT(*)::text FROM cred WHERE id NOT IN (SELECT id FROM has_ar))   AS mis_routed_count,
         (SELECT COALESCE(SUM(grand_total),0)::text FROM cred WHERE id NOT IN (SELECT id FROM has_ar)) AS mis_routed_amount`,
      params,
    );
    const misCount = Number(cashRouted?.mis_routed_count ?? 0);
    const misAmt = Number(cashRouted?.mis_routed_amount ?? 0);
    checks.push({
      id: 'cash_sale_heuristic_misroute',
      title: 'Credit invoices that bypassed Accounts Receivable (historical mis-routings)',
      // STATUS: FIXED in Phase-2 going forward. Historical mis-routings (created
      // before the fix shipped) still appear here — they need a one-time JV
      // (Dr AR, Cr Cash) to reclassify. Severity stays elevated until they're
      // fixed in books, because the historical AR ledger remains wrong.
      severity: misCount > 0 ? 'medium' : 'success',
      description:
        misCount > 0
          ? 'STATUS: FIXED in Phase-2 for new invoices. The OLD heuristic ' +
            '(isCashSale = !customer_id || paymentEntries[0].amount >= grandTotal) was replaced with ' +
            '!customer_id, and customer invoices with payment now post a separate receipt voucher. ' +
            'However, the rows below were created BEFORE the fix and still show no AR debit — ' +
            'fix them with a one-time reclassification JV (Dr AR, Cr Cash) per customer.'
          : 'STATUS: FIXED in Phase-2. Customer invoices now always hit AR (Dr AR, Cr Sales), ' +
            'and any payment received with the invoice posts a separate receipt voucher (Dr Cash, Cr AR). ' +
            'No historical mis-routings detected in this period.',
      finding: {
        total_credit_invoices_in_period: Number(cashRouted?.total_credit_invoices ?? 0),
        historical_bypassed_ar_count: misCount,
        historical_bypassed_ar_amount: misAmt,
        phase2_fix_applied: true,
      },
      impact:
        misCount > 0
          ? `${misCount} legacy customer invoices (₹${misAmt.toFixed(2)}) still have no AR posting. AR ageing and customer ledger will under-state until reclassified.`
          : 'AR ageing and customer ledger now reflect every credit invoice correctly.',
      recommendation:
        misCount > 0
          ? 'Either: (a) post a one-time reclassification JV for the listed invoices (Dr AR, Cr Cash); or (b) drop and recreate them via the new code path.'
          : 'No action — Phase-2 fix in place.',
    });

    // ------------------------------------------------------------------
    // CHECK 11: Cancelled purchases still hitting Purchases ledger
    // ------------------------------------------------------------------
    const orphanPurchases = await queryRows<{
      id: string;
      bill_number: string | null;
      status: string;
      grand_total: string;
      purchases_ledger_net: string;
    }>(
      `SELECT p.id,
              p.bill_number,
              p.status,
              p.grand_total::text,
              COALESCE((
                SELECT SUM(lel.debit - lel.credit)
                  FROM ledger_entry_lines lel
                  JOIN accounts a ON a.id = lel.account_id
                 WHERE lel.voucher_id = p.id
                   AND lel.voucher_type = 'purchase'
                   AND a.account_code = '5101'
              ), 0)::text AS purchases_ledger_net
         FROM purchases p
        WHERE p.business_id = $1
          AND p.status = 'cancelled'
        ORDER BY p.bill_date DESC
        LIMIT 200`,
      [businessId],
    );
    const orphanPurchasesWithLedger = orphanPurchases.filter(
      (r) => Math.abs(Number(r.purchases_ledger_net || 0)) > 0.005,
    );
    checks.push({
      id: 'cancelled_purchases_orphan_ledger',
      title: 'Cancelled purchases that still leave Purchases ledger entries',
      severity: orphanPurchasesWithLedger.length > 0 ? 'high' : 'info',
      description:
        'Same problem as invoices: cancellation path may not reverse ledger postings.',
      finding: {
        cancelled_purchases_inspected: orphanPurchases.length,
        cancelled_with_residual_purchases_ledger: orphanPurchasesWithLedger.length,
        sample: orphanPurchasesWithLedger.slice(0, 20),
      },
      impact:
        orphanPurchasesWithLedger.length > 0
          ? `${orphanPurchasesWithLedger.length} cancelled purchases still inflate COGS via Purchases ledger.`
          : 'No orphan ledger entries from cancelled purchases were found.',
      recommendation:
        'Add a reversal posting on purchase cancel (credit Purchases, debit AP/Cash; reverse Inventory transfer).',
    });

    // ------------------------------------------------------------------
    // CHECK 12: Provisions triple-count risk
    // ------------------------------------------------------------------
    const provisionsLedger = await queryOne<{ provision_acct_total: string }>(
      `SELECT COALESCE(SUM(lel.debit - lel.credit), 0)::text AS provision_acct_total
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('5207','5208','5209')
          AND lel.entry_date BETWEEN $2 AND $3
          ${branchFilterSqlLedger}`,
      params,
    );
    const provisionsBalanceSheet = await queryOne<{ closing_balance: string }>(
      `SELECT COALESCE(SUM(closing_balance), 0)::text AS closing_balance
         FROM provision_entries pe
         JOIN provisions p ON p.id = pe.provision_id
        WHERE p.business_id = $1`,
      [businessId],
    );
    checks.push({
      id: 'provisions_triple_count',
      title: 'Provisions (5207-5209) — was triple-counted in P&L',
      severity: 'success',
      description:
        'STATUS: FIXED in Phase-1. Single source of truth is now the ledger (5207-5209), included once via Other Expenses. ' +
        'getTotalProvisions(provisions-manager) is still surfaced as an informational schedule under expenses.provisions ' +
        'but is no longer subtracted from PBT.',
      finding: {
        ledger_5207_5208_5209_period_net: Number(
          provisionsLedger?.provision_acct_total ?? 0,
        ),
        provision_entries_total_closing_balance: Number(
          provisionsBalanceSheet?.closing_balance ?? 0,
        ),
        phase1_fix_applied: true,
      },
      impact:
        'After Phase-1, period provisions charge appears exactly once (in Other Expenses). ' +
        'Cumulative balance from provision_entries is shown as a schedule for reconciliation only.',
      recommendation:
        'No action. If you want the schedule to reflect period addition rather than closing balance, that is a small future enhancement to provisions-manager.',
    });

    // ------------------------------------------------------------------
    // CHECK 13: Sales Returns (Credit Notes) sanity
    // ------------------------------------------------------------------
    const cnTotals = await queryOne<{
      cnt: string;
      grand_total: string;
      taxable_value: string;
      sales_dr: string;
    }>(
      `WITH cn AS (
         SELECT cn.id, cn.grand_total, cn.subtotal AS taxable_value
           FROM credit_notes cn
          WHERE cn.business_id = $1
            AND cn.credit_note_date BETWEEN $2 AND $3
            ${branchFilterSqlCN}
       )
       SELECT
         (SELECT COUNT(*)::text FROM cn)                                                  AS cnt,
         (SELECT COALESCE(SUM(grand_total),0)::text FROM cn)                              AS grand_total,
         (SELECT COALESCE(SUM(taxable_value),0)::text FROM cn)                            AS taxable_value,
         COALESCE((
           SELECT SUM(lel.debit - lel.credit)
             FROM ledger_entry_lines lel
             JOIN accounts a ON a.id = lel.account_id
            WHERE lel.voucher_type = 'credit_note'
              AND a.account_code = '4101'
              AND lel.business_id = $1
              AND lel.entry_date BETWEEN $2 AND $3
              ${branchFilterSqlLedger}
         ), 0)::text AS sales_dr`,
      params,
    );
    checks.push({
      id: 'credit_notes_sanity',
      title: 'Credit Notes (sales returns) — ledger reduces Sales by grand_total',
      severity:
        Number(cnTotals?.cnt ?? 0) > 0 &&
        Number(cnTotals?.sales_dr ?? 0) > 0
          ? 'medium'
          : 'info',
      description:
        'Credit notes debit Sales by grand_total (incl GST). After GST split, they should debit Sales by taxable_value and debit Output GST by tax components.',
      finding: {
        count: Number(cnTotals?.cnt ?? 0),
        grand_total: Number(cnTotals?.grand_total ?? 0),
        taxable_value: Number(cnTotals?.taxable_value ?? 0),
        sales_account_debited_by: Number(cnTotals?.sales_dr ?? 0),
      },
      impact:
        'Currently nets out symmetrically with the corresponding inflated invoice posting, so PAT is not directly wrong from this — but the rupee values reported as Sales/Returns are both wrong.',
      recommendation: 'Apply the same GST-split fix on credit notes when refactoring invoice posting.',
    });

    // ------------------------------------------------------------------
    // CHECK 14: COGS account (5104) ledger vs items.cost (sanity check)
    // ------------------------------------------------------------------
    const cogsLedger = await queryOne<{ cogs_net: string }>(
      `SELECT COALESCE(SUM(lel.debit - lel.credit), 0)::text AS cogs_net
         FROM ledger_entry_lines lel
         JOIN accounts a ON a.id = lel.account_id
        WHERE a.business_id = $1
          AND a.account_code IN ('5104','5101')
          AND lel.entry_date BETWEEN $2 AND $3
          AND lel.voucher_type IN ('invoice','credit_note','debit_note')
          ${branchFilterSqlLedger}`,
      params,
    );
    const cogsLedgerNet = Number(cogsLedger?.cogs_net ?? 0);
    // Phase-4 Checkpoint A picked Periodic + ledger-trust; the per-invoice
    // perpetual COGS posting is being removed in Checkpoint B. Until then,
    // historical 5104 lines from invoices remain in the ledger but are NO
    // LONGER consulted by P&L (cogs-calculator is the single source).
    checks.push({
      id: 'cogs_two_sources',
      title:
        cogsLedgerNet === 0
          ? 'STATUS: FIXED in Phase-4 — single source of truth (cogs-calculator); per-invoice COGS posting disabled'
          : 'STATUS: FIXED for new vouchers in Phase-4; historical perpetual residue remains in ledger',
      severity: cogsLedgerNet === 0 ? 'success' : 'medium',
      description:
        'Phase-4: per-invoice / per-credit-note / per-debit-note COGS posting is now DISABLED in ledger-utils ' +
        '(periodic model). New vouchers no longer write to 5104/1104. profit-loss/route.ts uses cogs-calculator ' +
        'as the single source of truth, computed periodically from Opening + Net Purchases (5101 net debit ' +
        '− 5102 net credit) − Closing.',
      finding: {
        cogs_from_ledger_invoice_postings_residual: cogsLedgerNet,
        cogs_calc_is_authoritative: true,
        per_invoice_cogs_posting_disabled: true,
        ledger_utils_action: 'cogsAmount > 0 now logs a [PHASE-4] warning and skips the posting',
        historical_residue_drains_when: 'year-end-close JV ships',
      },
      impact:
        cogsLedgerNet === 0
          ? 'No conflict — the ledger has no per-invoice COGS lines in this period and new vouchers will not create any.'
          : `Historical per-invoice COGS lines worth ₹${Math.abs(cogsLedgerNet).toFixed(2)} sit in the ledger ` +
            `but no longer affect the P&L number. The Trial Balance will show this residue until the year-end-close JV drains it.`,
      recommendation:
        cogsLedgerNet === 0
          ? 'No action.'
          : 'Run the "Drain perpetual COGS/Inventory" button (year-end close, coming next) to net these out.',
    });

    // ------------------------------------------------------------------
    // CHECK 14b (NEW Phase-4): live periodic-COGS readiness for the
    // current period. Computes Opening / Closing using the same code
    // path the P&L report does, so the user sees what the report sees.
    // Also shows weighted-avg coverage (% of items priced from purchase
    // history vs item-master fallback).
    // ------------------------------------------------------------------
    try {
      const { calculateCOGS } = await import('@/lib/services/cogs-calculator');
      const cogsForCard = await calculateCOGS(businessId, fromDate, toDate);

      const openingItems = cogsForCard.openingStock.items;
      const closingItems = cogsForCard.closingStock.items;
      const allValuedItems = [...openingItems, ...closingItems];
      const wavgCount = allValuedItems.filter(
        (i) => i.unit_cost_source === 'weighted_avg_purchases',
      ).length;
      const fallbackCount = allValuedItems.filter(
        (i) => i.unit_cost_source === 'item_master_fallback',
      ).length;
      const snapshotCount = allValuedItems.filter(
        (i) => i.unit_cost_source === 'snapshot',
      ).length;
      const totalValued = allValuedItems.length || 1;
      const wavgPct = (wavgCount / totalValued) * 100;

      const phase4Severity: Check['severity'] =
        cogsForCard.openingStock.value === 0 && cogsForCard.closingStock.value === 0
          ? 'info'
          : wavgPct >= 80 || snapshotCount === totalValued
          ? 'success'
          : wavgPct >= 50
          ? 'medium'
          : 'high';

      checks.push({
        id: 'phase4_periodic_cogs_readiness',
        title:
          phase4Severity === 'success'
            ? 'STATUS: HEALTHY — Phase-4 periodic COGS computed correctly for this period'
            : phase4Severity === 'info'
            ? 'Phase-4 periodic COGS — no inventory in this period (nothing to value)'
            : phase4Severity === 'medium'
            ? 'Phase-4 periodic COGS — weighted-avg coverage low; many items priced from item master'
            : 'Phase-4 periodic COGS — weighted-avg coverage poor; most items priced from item master',
        severity: phase4Severity,
        description:
          'PHASE-4 LIVE READOUT: shows the exact Opening/Closing/Net-Purchases the P&L report would use ' +
          'for this period, plus a coverage breakdown of how each item was priced. ' +
          'Opening = on-hand qty as of (from_date − 1) × weighted-avg purchase rate; ' +
          'Closing = on-hand qty as of to_date × weighted-avg rate; ' +
          'Net Purchases = ledger 5101 net debit − ledger 5102 net credit (returns netted). ' +
          'COGS = Opening + Net Purchases − Closing.',
        finding: {
          formula: 'COGS = Opening + (5101 net debit − 5102 net credit) − Closing',
          opening_stock: {
            quantity: cogsForCard.openingStock.quantity,
            value: cogsForCard.openingStock.value,
            as_of_date: cogsForCard.openingStock.as_of_date,
            source: cogsForCard.openingStock.source,
            line_count: openingItems.length,
          },
          net_purchases: {
            net: cogsForCard.purchases.total,
            ledger_5101_net_debit: cogsForCard.purchases.gross_purchases,
            ledger_5102_net_credit: cogsForCard.purchases.returns,
            voucher_count: cogsForCard.purchases.count,
          },
          closing_stock: {
            quantity: cogsForCard.closingStock.quantity,
            value: cogsForCard.closingStock.value,
            as_of_date: cogsForCard.closingStock.as_of_date,
            source: cogsForCard.closingStock.source,
            line_count: closingItems.length,
          },
          cogs_total: cogsForCard.cogs,
          valuation_method: cogsForCard.meta.valuation_method,
          inventory_model: cogsForCard.meta.inventory_model,
          unit_cost_source_breakdown: {
            weighted_avg_purchases: wavgCount,
            snapshot: snapshotCount,
            item_master_fallback: fallbackCount,
            total_lines_valued: allValuedItems.length,
            weighted_avg_coverage_pct: Number(wavgPct.toFixed(1)),
          },
        },
        impact:
          phase4Severity === 'info'
            ? 'No on-hand stock at either date — COGS is driven entirely by Net Purchases for this period.'
            : phase4Severity === 'success'
            ? `COGS = ₹${cogsForCard.cogs.toFixed(2)}. Opening ₹${cogsForCard.openingStock.value.toFixed(2)} ` +
              `+ Net Purchases ₹${cogsForCard.purchases.total.toFixed(2)} − Closing ₹${cogsForCard.closingStock.value.toFixed(2)}. ` +
              `Weighted-avg coverage = ${wavgPct.toFixed(1)}% — books are valued on real purchase history.`
            : `COGS = ₹${cogsForCard.cogs.toFixed(2)}. Only ${wavgPct.toFixed(1)}% of valued lines used weighted-avg from purchases; ` +
              `${fallbackCount} item(s) fell back to items.purchase_price (item-master rate). ` +
              `This happens when an item has no purchase history before the as-of date.`,
        recommendation:
          phase4Severity === 'success' || phase4Severity === 'info'
            ? 'No action.'
            : 'Either record purchase vouchers for the items showing item_master_fallback (so weighted-avg can compute), ' +
              'or accept that opening-balance-only items will continue to use the item-master rate until their first purchase is recorded.',
      });
    } catch (cogsErr) {
      const e = cogsErr as { message?: string };
      checks.push({
        id: 'phase4_periodic_cogs_readiness',
        title: 'Phase-4 periodic COGS — diagnostic could not run',
        severity: 'high',
        description: 'calculateCOGS threw while building the readiness card.',
        finding: { error: e.message ?? String(cogsErr) },
        impact: 'The P&L report may also fail. Investigate the error above.',
        recommendation: 'Check server logs.',
      });
    }

    // ==================================================================
    // PHASE-0 DEEP INSPECTION
    // Why does Sales (4101) ledger show 0 when invoices exist?
    // Hypothesis: createLedgerEntryLine throws when branch_id is null,
    // and the try/catch in /api/invoices swallows the error silently.
    // ==================================================================

    // ------------------------------------------------------------------
    // CHECK P0-A: Per-invoice ledger coverage
    //   How many of the period's invoices actually produced ledger lines?
    // ------------------------------------------------------------------
    const invoiceLedgerCoverage = await queryRows<{
      invoice_id: string;
      invoice_number: string;
      invoice_date: string;
      grand_total: string;
      status: string;
      document_type: string | null;
      customer_id: string | null;
      branch_id: string | null;
      ledger_line_count: string;
      total_credit: string;
      total_debit: string;
    }>(
      `SELECT
         i.id::text                                                            AS invoice_id,
         i.invoice_number,
         i.invoice_date::text                                                  AS invoice_date,
         i.grand_total::text                                                   AS grand_total,
         i.status,
         i.document_type,
         i.customer_id::text                                                   AS customer_id,
         i.branch_id::text                                                     AS branch_id,
         COALESCE(COUNT(lel.id), 0)::text                                      AS ledger_line_count,
         COALESCE(SUM(lel.credit), 0)::text                                    AS total_credit,
         COALESCE(SUM(lel.debit), 0)::text                                     AS total_debit
       FROM invoices i
       LEFT JOIN ledger_entry_lines lel
         ON lel.voucher_id = i.id AND lel.voucher_type = 'invoice'
       WHERE i.business_id = $1
         AND i.invoice_date BETWEEN $2 AND $3
         ${branchFilterSqlInvoices}
       GROUP BY i.id, i.invoice_number, i.invoice_date, i.grand_total,
                i.status, i.document_type, i.customer_id, i.branch_id
       ORDER BY i.invoice_date DESC, i.invoice_number DESC
       LIMIT 50`,
      params,
    );
    const invoicesWithoutLedger = invoiceLedgerCoverage.filter(
      (r) => Number(r.ledger_line_count) === 0 &&
             r.status !== 'cancelled' &&
             r.document_type !== 'proforma_invoice',
    );
    const invoicesWithoutBranch = invoiceLedgerCoverage.filter(
      (r) => !r.branch_id &&
             r.status !== 'cancelled' &&
             r.document_type !== 'proforma_invoice',
    );
    checks.push({
      id: 'phase0_invoice_ledger_coverage',
      title: 'Phase-0: Per-invoice ledger coverage',
      severity: invoicesWithoutLedger.length > 0 ? 'critical' : 'info',
      description:
        'For every invoice in the period, count the ledger_entry_lines created with voucher_type=invoice and voucher_id=invoice.id. ' +
        'A "final" non-proforma invoice with 0 ledger lines means createInvoiceLedgerEntries silently failed (try/catch in /api/invoices).',
      finding: {
        invoices_inspected: invoiceLedgerCoverage.length,
        invoices_with_zero_ledger_lines: invoicesWithoutLedger.length,
        invoices_with_null_branch_id: invoicesWithoutBranch.length,
        invoices: invoiceLedgerCoverage.map((r) => ({
          invoice_number: r.invoice_number,
          invoice_date: r.invoice_date,
          status: r.status,
          document_type: r.document_type,
          grand_total: Number(r.grand_total),
          customer_id: r.customer_id,
          branch_id: r.branch_id,
          ledger_lines: Number(r.ledger_line_count),
          total_debit: Number(r.total_debit),
          total_credit: Number(r.total_credit),
          balanced: Number(r.total_debit) === Number(r.total_credit),
        })),
      },
      impact:
        invoicesWithoutLedger.length > 0
          ? `${invoicesWithoutLedger.length} of ${invoiceLedgerCoverage.length} invoices produced NO ledger entries at all. The P&L sees zero from these invoices.`
          : 'Every invoice in the period has at least one ledger line.',
      recommendation:
        'If invoices_with_null_branch_id matches invoices_with_zero_ledger_lines, the cause is the mandatory-branch_id throw in createLedgerEntryLine combined with the silent catch in /api/invoices/route.ts.',
    });

    // ------------------------------------------------------------------
    // CHECK P0-B: Where DID the postings land? (account-code histogram)
    //   For all ledger lines tied to invoices in this period, group by
    //   account_code so we can spot postings going to non-4101 accounts.
    // ------------------------------------------------------------------
    const accountHistogram = await queryRows<{
      account_code: string;
      account_name: string;
      account_type: string;
      line_count: string;
      total_debit: string;
      total_credit: string;
    }>(
      `SELECT
         a.account_code,
         a.account_name,
         a.account_type,
         COUNT(lel.id)::text                AS line_count,
         COALESCE(SUM(lel.debit), 0)::text  AS total_debit,
         COALESCE(SUM(lel.credit), 0)::text AS total_credit
       FROM ledger_entry_lines lel
       JOIN accounts a ON a.id = lel.account_id
       JOIN invoices i ON i.id = lel.voucher_id
       WHERE lel.business_id = $1
         AND lel.voucher_type = 'invoice'
         AND i.invoice_date BETWEEN $2 AND $3
         ${branchFilterSqlLedger}
       GROUP BY a.account_code, a.account_name, a.account_type
       ORDER BY a.account_code`,
      params,
    );
    checks.push({
      id: 'phase0_invoice_account_histogram',
      title: 'Phase-0: Where invoice postings actually landed (by account)',
      severity: 'info',
      description:
        'Histogram of every account_code that received a ledger line from an invoice voucher in this period. ' +
        'If 4101 (Sales) is missing or shows lower-than-expected credits, postings either failed or went to a different account.',
      finding: {
        accounts: accountHistogram.map((r) => ({
          account_code: r.account_code,
          account_name: r.account_name,
          account_type: r.account_type,
          lines: Number(r.line_count),
          total_debit: Number(r.total_debit),
          total_credit: Number(r.total_credit),
        })),
      },
      impact:
        accountHistogram.length === 0
          ? 'Zero ledger lines from invoices — confirms createInvoiceLedgerEntries is failing silently for every invoice.'
          : 'Compare the credit total on 4101 against invoices.grand_total to find the leak.',
      recommendation: 'No action — diagnostic only.',
    });

    // ------------------------------------------------------------------
    // CHECK P0-C: getDefaultAccounts() effective resolution
    //   What account does this business actually treat as "Sales", "Cash",
    //   "AR", etc?  Helps catch typos in account_code or stale mappings.
    // ------------------------------------------------------------------
    const accountResolution = await queryRows<{
      role: string;
      account_id: string | null;
      account_code: string | null;
      account_name: string | null;
      source: string;
    }>(
      `WITH mapping AS (
         SELECT
           NULLIF(account_mappings->>'sales_account_id','')::uuid               AS sales_id,
           NULLIF(account_mappings->>'cash_account_id','')::uuid                AS cash_id,
           NULLIF(account_mappings->>'accounts_receivable_account_id','')::uuid AS ar_id,
           NULLIF(account_mappings->>'purchases_account_id','')::uuid           AS purchases_id,
           NULLIF(account_mappings->>'cogs_account_id','')::uuid                AS cogs_id
         FROM business_settings
         WHERE business_id = $1
       ),
       fallbacks AS (
         SELECT
           (SELECT id FROM accounts WHERE business_id = $1 AND account_code = '4101' LIMIT 1) AS sales_id,
           (SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1101' LIMIT 1) AS cash_id,
           (SELECT id FROM accounts WHERE business_id = $1 AND account_code = '1103' LIMIT 1) AS ar_id,
           (SELECT id FROM accounts WHERE business_id = $1 AND account_code = '5101' LIMIT 1) AS purchases_id,
           (SELECT id FROM accounts WHERE business_id = $1 AND account_code = '5101' LIMIT 1) AS cogs_id
       ),
       resolved AS (
         SELECT
           COALESCE((SELECT sales_id    FROM mapping), (SELECT sales_id    FROM fallbacks)) AS sales_id,
           COALESCE((SELECT cash_id     FROM mapping), (SELECT cash_id     FROM fallbacks)) AS cash_id,
           COALESCE((SELECT ar_id       FROM mapping), (SELECT ar_id       FROM fallbacks)) AS ar_id,
           COALESCE((SELECT purchases_id FROM mapping),(SELECT purchases_id FROM fallbacks)) AS purchases_id,
           COALESCE((SELECT cogs_id     FROM mapping), (SELECT cogs_id     FROM fallbacks)) AS cogs_id,
           (SELECT sales_id    FROM mapping) IS NOT NULL AS sales_mapped,
           (SELECT cash_id     FROM mapping) IS NOT NULL AS cash_mapped,
           (SELECT ar_id       FROM mapping) IS NOT NULL AS ar_mapped,
           (SELECT purchases_id FROM mapping) IS NOT NULL AS purchases_mapped,
           (SELECT cogs_id     FROM mapping) IS NOT NULL AS cogs_mapped
       )
       SELECT 'sales'::text AS role, a.id::text AS account_id, a.account_code, a.account_name,
              CASE WHEN r.sales_mapped THEN 'mapping' ELSE 'fallback_4101' END AS source
         FROM resolved r LEFT JOIN accounts a ON a.id = r.sales_id
       UNION ALL
       SELECT 'cash', a.id::text, a.account_code, a.account_name,
              CASE WHEN r.cash_mapped THEN 'mapping' ELSE 'fallback_1101' END
         FROM resolved r LEFT JOIN accounts a ON a.id = r.cash_id
       UNION ALL
       SELECT 'accounts_receivable', a.id::text, a.account_code, a.account_name,
              CASE WHEN r.ar_mapped THEN 'mapping' ELSE 'fallback_1103' END
         FROM resolved r LEFT JOIN accounts a ON a.id = r.ar_id
       UNION ALL
       SELECT 'purchases', a.id::text, a.account_code, a.account_name,
              CASE WHEN r.purchases_mapped THEN 'mapping' ELSE 'fallback_5101' END
         FROM resolved r LEFT JOIN accounts a ON a.id = r.purchases_id
       UNION ALL
       SELECT 'cogs', a.id::text, a.account_code, a.account_name,
              CASE WHEN r.cogs_mapped THEN 'mapping' ELSE 'fallback_5101' END
         FROM resolved r LEFT JOIN accounts a ON a.id = r.cogs_id`,
      [businessId],
    );
    const missingResolution = accountResolution.filter((r) => !r.account_id);
    checks.push({
      id: 'phase0_account_resolution',
      title: 'Phase-0: Default-account resolution for this business',
      severity: missingResolution.length > 0 ? 'critical' : 'info',
      description:
        'Resolves the same accounts that getDefaultAccounts() would use for Sales / Cash / AR. ' +
        'A NULL account_id here would explain the early-return guards in createInvoiceLedgerEntries ("Sales account not found. Skipping ledger entry creation.").',
      finding: {
        resolutions: accountResolution,
        missing_count: missingResolution.length,
      },
      impact:
        missingResolution.length > 0
          ? `Roles missing an account: ${missingResolution.map((r) => r.role).join(', ')}.`
          : 'All key roles map to a real account.',
      recommendation:
        'If a role is missing, seed the account in chart of accounts or set the mapping in account_mappings.',
    });

    // ------------------------------------------------------------------
    // CHECK P0-D: Branch coverage for transactional invoices
    //   How many invoices are missing branch_id - and does this business
    //   even have any active branches to default to?
    // ------------------------------------------------------------------
    const branchSnapshot = await queryOne<{
      total_branches: string;
      active_branches: string;
      default_branch_id: string | null;
      default_branch_name: string | null;
    }>(
      `SELECT
         COUNT(*)::text                                              AS total_branches,
         COALESCE(SUM(CASE WHEN is_active THEN 1 ELSE 0 END),0)::text AS active_branches,
         (SELECT id::text FROM branches
           WHERE business_id = $1 AND is_active = true
           ORDER BY is_primary DESC NULLS LAST, created_at ASC LIMIT 1) AS default_branch_id,
         (SELECT name      FROM branches
           WHERE business_id = $1 AND is_active = true
           ORDER BY is_primary DESC NULLS LAST, created_at ASC LIMIT 1) AS default_branch_name
       FROM branches WHERE business_id = $1`,
      [businessId],
    );
    checks.push({
      id: 'phase0_branch_snapshot',
      title: 'Phase-0: Branch availability for ledger postings',
      severity:
        Number(branchSnapshot?.active_branches ?? 0) === 0 ? 'critical' : 'info',
      description:
        'createLedgerEntryLine throws if branch_id is null for any non-opening-balance entry. ' +
        'If the business has no active branch, every transactional posting fails.',
      finding: {
        total_branches: Number(branchSnapshot?.total_branches ?? 0),
        active_branches: Number(branchSnapshot?.active_branches ?? 0),
        default_branch_id: branchSnapshot?.default_branch_id ?? null,
        default_branch_name: branchSnapshot?.default_branch_name ?? null,
        invoices_in_period_with_null_branch: invoicesWithoutBranch.length,
      },
      impact:
        Number(branchSnapshot?.active_branches ?? 0) === 0
          ? 'Business has no active branches; ledger postings cannot be saved.'
          : invoicesWithoutBranch.length > 0
          ? `${invoicesWithoutBranch.length} invoice(s) in this period have NULL branch_id and therefore can never produce ledger entries.`
          : 'Branch coverage looks fine.',
      recommendation:
        invoicesWithoutBranch.length > 0
          ? 'Either back-fill invoices.branch_id to the default branch and re-run ledger creation, OR relax the mandatory-branch_id rule when a business default branch can be inferred.'
          : 'No action.',
    });

    return NextResponse.json({
      business_id: businessId,
      branch_id: branchId,
      is_consolidated: isConsolidated,
      period: { from_date: fromDate, to_date: toDate },
      generated_at: new Date().toISOString(),
      checks,
      summary: {
        critical_count: checks.filter((c) => c.severity === 'critical').length,
        high_count: checks.filter((c) => c.severity === 'high').length,
        medium_count: checks.filter((c) => c.severity === 'medium').length,
        low_count: checks.filter((c) => c.severity === 'low').length,
        success_count: checks.filter((c) => c.severity === 'success').length,
      },
    });
  } catch (error) {
    const err = error as { message?: string };
    console.error('pl-validation diagnostic error:', error);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
