import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { cashAccountSql } from '@/lib/accounting/cash-accounts';
import { activeLedgerLineSql } from '@/lib/ledger-reversal';
import { classifyBsAccount } from '@/lib/reports/balance-sheet';
import { loadGroupMap } from '@/lib/reports/account-groups';
import { buildDashboardCashFlow, type CashMovement } from '@/lib/reports/dashboard-cash-flow';

export const dynamic = 'force-dynamic';

const OPENING_VOUCHERS = ['opening_balance', 'opening_stock'];

/**
 * GET /api/dashboard/cash-flow
 * Monthly movement of the cash and bank ledgers for a fiscal year (April to March).
 *
 * Read from ledger lines, not from the payments and expenses tables, so everything that moves
 * money is counted: receipts, supplier payments, cash sales and purchases posted on the bill,
 * expenses, salaries, tax payments, capital, drawings, loans and journals.
 *
 * - Lines of one voucher on one date are netted across the cash and bank ledgers, so a contra
 *   (cash deposited to bank, transfer between banks) is neither money in nor money out.
 * - Reversed lines and their reversals are left out, so a reversed payment or a cancelled
 *   cash sale is shown as if it was never entered.
 * - Opening-balance vouchers count as the opening figure, whatever their date in the year.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;
    const { searchParams } = new URL(request.url);

    try {
      await authorize(userId, 'dashboard', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Fiscal year starts in April; January to March belong to the year that started before.
    const now = new Date();
    const currentStartYear = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const requested = parseInt(searchParams.get('fiscal_year') || '', 10);
    const startYear = requested >= 2000 && requested <= 2100 ? requested : currentStartYear;
    const fyStart = `${startYear}-04-01`;
    const fyEnd = `${startYear + 1}-03-31`;

    const rows = await queryRows<{
      month: string | null;
      direction: 'in' | 'out' | null;
      account_code: string | null;
      account_name: string | null;
      account_type: string | null;
      account_group_id: string | null;
      net: string;
    }>(
      `
      WITH cash_accounts AS (
        SELECT a.id
          FROM accounts a
          LEFT JOIN account_groups ag ON ag.id = a.account_group_id
         WHERE a.business_id = $1
           AND ${cashAccountSql('a', 'ag')}
      ),
      vouchers AS (
        SELECT l.voucher_id, l.voucher_type, l.entry_date,
               (l.entry_date < $2::date OR l.voucher_type = ANY($4::text[])) AS is_opening,
               SUM(l.debit - l.credit) AS net
          FROM ledger_entry_lines l
          JOIN cash_accounts ca ON ca.id = l.account_id
         WHERE l.business_id = $1
           AND l.entry_date <= $3::date
           AND ${activeLedgerLineSql('l')}
         GROUP BY l.voucher_id, l.voucher_type, l.entry_date
      ),
      counter AS (
        SELECT DISTINCT ON (v.voucher_id, v.voucher_type, v.entry_date)
               v.voucher_id, v.voucher_type, v.entry_date, c.account_id
          FROM vouchers v
          JOIN ledger_entry_lines c
            ON c.business_id = $1
           AND c.voucher_id = v.voucher_id
           AND c.voucher_type = v.voucher_type
           AND c.entry_date = v.entry_date
         WHERE NOT v.is_opening
           AND v.net <> 0
           AND c.account_id NOT IN (SELECT id FROM cash_accounts)
           AND ${activeLedgerLineSql('c')}
           AND ((v.net > 0 AND c.credit > 0) OR (v.net < 0 AND c.debit > 0))
         ORDER BY v.voucher_id, v.voucher_type, v.entry_date, GREATEST(c.debit, c.credit) DESC, c.account_id
      )
      SELECT
        CASE WHEN v.is_opening THEN NULL ELSE TO_CHAR(v.entry_date, 'YYYY-MM') END AS month,
        CASE WHEN v.is_opening THEN NULL WHEN v.net > 0 THEN 'in' ELSE 'out' END AS direction,
        a.account_code, a.account_name, a.account_type, a.account_group_id,
        SUM(v.net) AS net
      FROM vouchers v
      LEFT JOIN counter k
        ON NOT v.is_opening
       AND k.voucher_id = v.voucher_id
       AND k.voucher_type = v.voucher_type
       AND k.entry_date = v.entry_date
      LEFT JOIN accounts a ON a.id = k.account_id
      WHERE v.is_opening OR v.net <> 0
      GROUP BY 1, 2, a.account_code, a.account_name, a.account_type, a.account_group_id
      `,
      [businessId, fyStart, fyEnd, OPENING_VOUCHERS]
    );

    const groups = await loadGroupMap(businessId);
    let opening = 0;
    const movements: CashMovement[] = [];
    for (const r of rows) {
      const net = Number(r.net) || 0;
      if (!r.month || !r.direction) {
        opening += net;
        continue;
      }
      movements.push({
        month: r.month,
        direction: r.direction,
        amount: Math.abs(net),
        counter:
          r.account_code && r.account_type
            ? {
                code: r.account_code,
                name: r.account_name || '',
                type: r.account_type,
                bsClass: classifyBsAccount(r.account_type, r.account_group_id, groups),
              }
            : null,
      });
    }

    return NextResponse.json(buildDashboardCashFlow({ startYear, opening, movements }));
  } catch (error: any) {
    console.error('Error fetching cash flow data:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
