import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne } from '@/lib/db';
import { calculateCOGS } from '@/lib/services/cogs-calculator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { CREDIT_SECTIONS, isPlSection } from '@/lib/accounting/pl-sections';
import { previousFinancialYear } from '@/lib/reports/profit-loss';

export const dynamic = 'force-dynamic';

const MAX_ROWS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Line = 'account' | 'purchases' | 'opening_stock' | 'closing_stock';

const DOCUMENT_LINKS: Record<string, string> = {
  invoice: '/invoices',
  purchase: '/purchases',
  credit_note: '/credit-notes',
  debit_note: '/debit-notes',
  journal: '/journal-entries',
};

/**
 * GET /api/reports/profit-loss/drilldown
 *
 * Explains one P&L figure. Filters mirror /api/reports/profit-loss exactly so
 * the drill-down total always equals the number shown on the statement:
 *   line=account&account_ids=a,b  → vouchers posted to those accounts
 *   line=purchases                → vouchers behind "Add: Purchases" (5101 − 5102)
 *   line=opening_stock|closing_stock → item-wise stock valuation
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const line = searchParams.get('line') as Line | null;

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }
    if (!fromDate || !toDate || !DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
      return NextResponse.json({ error: 'from_date and to_date (YYYY-MM-DD) are required' }, { status: 400 });
    }
    if (!line || !['account', 'purchases', 'opening_stock', 'closing_stock'].includes(line)) {
      return NextResponse.json({ error: 'Invalid line' }, { status: 400 });
    }

    const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
    const accessCheck = await checkEmployeeAccessBoundary(userId, 'portal');
    if (!accessCheck.allowed) {
      return NextResponse.json({ error: accessCheck.reason, code: 'ACCESS_DENIED' }, { status: 403 });
    }

    try {
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const isConsolidatedView = !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';
    let finalBranchId: string | null = null;
    let branchFilter = '';
    let branchParam: string | string[] | null = null;

    if (!isConsolidatedView) {
      const { resolveBranchId, isDefaultBranch } = await import('@/lib/branch-helpers');
      try {
        finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
      } catch (error: any) {
        if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error.code === 'NO_DEFAULT_BRANCH') {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
      branchFilter = (await isDefaultBranch(finalBranchId, businessId))
        ? 'AND (lel.branch_id = $5 OR lel.branch_id IS NULL)'
        : 'AND lel.branch_id = $5';
      branchParam = finalBranchId;
    } else {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      if (accessibleBranchIds.length > 0) {
        branchFilter = 'AND (lel.branch_id = ANY($5::uuid[]) OR lel.branch_id IS NULL)';
        branchParam = accessibleBranchIds;
      }
    }

    try {
      await authorize(userId, 'report.financial', 'read', {
        businessId,
        branchId: finalBranchId || undefined,
        resource: { business_id: businessId, branch_id: finalBranchId || undefined },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (line === 'opening_stock' || line === 'closing_stock') {
      const financialYear = searchParams.get('financial_year');
      const cogs = await calculateCOGS(
        businessId, fromDate, toDate, financialYear || undefined, previousFinancialYear(financialYear)
      );
      const stock = line === 'opening_stock' ? cogs.openingStock : cogs.closingStock;
      const rows = [...stock.items]
        .filter((i) => Math.abs(i.quantity) > 0.0001 || Math.abs(i.total_value) > 0.005)
        .sort((a, b) => b.total_value - a.total_value)
        .map((i) => ({
          item_id: i.item_id,
          item_name: i.item_name,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          total_value: i.total_value,
          unit_cost_source: i.unit_cost_source ?? null,
          link: `/items/${i.item_id}`,
        }));
      return NextResponse.json({
        kind: 'items',
        title: line === 'opening_stock' ? 'Opening Stock' : 'Closing Stock',
        as_of_date: stock.as_of_date,
        source: stock.source,
        valuation_method: cogs.meta.valuation_method,
        total: stock.value,
        count: rows.length,
        truncated: false,
        rows,
      });
    }

    let accountIds: string[];
    let title: string;
    // "Add: Purchases" comes from cogs-calculator, which reads 5101/5102 without
    // the year_close exclusion or branch scoping; mirror it so totals agree.
    let mirrorCogsCalculator = false;

    if (line === 'purchases') {
      const rows = await queryRows<{ id: string }>(
        `SELECT id FROM accounts WHERE business_id = $1 AND account_code IN ('5101', '5102')`,
        [businessId],
      );
      accountIds = rows.map((r) => r.id);
      title = 'Purchases (net of returns)';
      mirrorCogsCalculator = true;
    } else {
      accountIds = (searchParams.get('account_ids') || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s));
      if (accountIds.length === 0) {
        return NextResponse.json({ error: 'account_ids is required' }, { status: 400 });
      }
      const names = await queryRows<{ account_code: string; account_name: string }>(
        `SELECT account_code, account_name FROM accounts
          WHERE business_id = $1 AND id = ANY($2::uuid[]) ORDER BY account_code`,
        [businessId, accountIds],
      );
      if (names.length === 0) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      }
      title = names.length === 1
        ? `${names[0].account_code} ${names[0].account_name}`
        : names.map((n) => n.account_name).join(' + ');
    }

    if (accountIds.length === 0) {
      return NextResponse.json({ kind: 'vouchers', title, total: 0, count: 0, truncated: false, rows: [] });
    }

    // With a section, amounts are signed the way the statement shows them (contra accounts negative).
    const sectionParam = searchParams.get('section');
    const sectionSign = isPlSection(sectionParam) && sectionParam !== 'elimination'
      ? (CREDIT_SECTIONS.has(sectionParam) ? 'lel.credit - lel.debit' : 'lel.debit - lel.credit')
      : null;
    const amountSql = sectionSign
      ?? `CASE WHEN a.account_type = 'income' THEN lel.credit - lel.debit ELSE lel.debit - lel.credit END`;

    const params: any[] = [accountIds, businessId, fromDate, toDate];
    let scopeSql = '';
    if (!mirrorCogsCalculator) {
      scopeSql = `AND lel.voucher_type <> 'year_close' ${branchFilter}`;
      if (branchFilter) params.push(branchParam);
    }

    const vouchersCte = `
      WITH v AS (
        SELECT
          COALESCE(lel.voucher_id::text, lel.id::text) AS voucher_key,
          lel.voucher_id,
          lel.voucher_type,
          MIN(lel.entry_date)::text AS entry_date,
          SUM(${amountSql})::float AS amount,
          MAX(lel.narration) AS narration,
          MAX(lel.reference_number) AS reference_number
        FROM ledger_entry_lines lel
        JOIN accounts a ON a.id = lel.account_id
        WHERE lel.account_id = ANY($1::uuid[])
          AND lel.business_id = $2
          AND lel.entry_date >= $3
          AND lel.entry_date <= $4
          ${scopeSql}
        GROUP BY 1, 2, 3
        HAVING ABS(SUM(lel.debit - lel.credit)) > 0.004
      )`;

    const summary = await queryOne<{ total: number; count: number }>(
      `${vouchersCte} SELECT COALESCE(SUM(amount), 0)::float AS total, COUNT(*)::int AS count FROM v`,
      params,
    );

    const rows = await queryRows<any>(
      `${vouchersCte}
       SELECT
         v.voucher_id,
         v.voucher_type,
         v.entry_date,
         v.amount,
         v.narration,
         COALESCE(i.invoice_number, p.bill_number, v.reference_number) AS document_number,
         COALESCE(c.name, s.name) AS party_name,
         ((v.voucher_type <> 'invoice' OR i.id IS NOT NULL)
           AND (v.voucher_type <> 'purchase' OR p.id IS NOT NULL)) AS source_exists
       FROM v
       LEFT JOIN invoices i ON v.voucher_type = 'invoice' AND i.id = v.voucher_id AND i.business_id = $2
       LEFT JOIN customers c ON c.id = i.customer_id
       LEFT JOIN purchases p ON v.voucher_type = 'purchase' AND p.id = v.voucher_id AND p.business_id = $2
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       ORDER BY v.entry_date, v.voucher_type, document_number
       LIMIT ${MAX_ROWS}`,
      params,
    );

    return NextResponse.json({
      kind: 'vouchers',
      title,
      total: Number(summary?.total ?? 0),
      count: Number(summary?.count ?? 0),
      truncated: Number(summary?.count ?? 0) > rows.length,
      rows: rows.map((r) => {
        const base = r.voucher_id && r.source_exists ? DOCUMENT_LINKS[r.voucher_type] : undefined;
        return {
          voucher_id: r.voucher_id,
          voucher_type: r.voucher_type,
          entry_date: r.entry_date,
          document_number: r.document_number,
          party_name: r.party_name,
          narration: r.narration,
          amount: Number(r.amount),
          source_missing: !r.source_exists,
          link: base ? `${base}/${r.voucher_id}` : null,
        };
      }),
    });
  } catch (error: any) {
    console.error('Error generating profit & loss drilldown:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
