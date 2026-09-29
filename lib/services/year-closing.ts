/**
 * Year Closing Service
 * Executes complete financial year closing process
 */

import type { PoolClient } from 'pg';
import { queryOne, getPool } from '@/lib/db';
import { deleteVoucher, insertVoucherLines, requireAccountByCode, round2 } from '@/lib/accounting/voucher-posting';
import { postYearClosingVoucher } from '@/lib/accounting/year-close';
import {
  createClosingStockSnapshot,
  type ClosingValuationMethod,
} from './closing-stock-valuator';
import { calculateDepreciationForAllAssets, saveDepreciationSchedule } from './depreciation-calculator';
import { getTotalProvisions } from './provisions-manager';
import { getAllTaxProvisions, createOrUpdateTaxProvision, calculateCurrentTax } from './tax-provision-calculator';
export interface YearClosingResult {
  financial_year_id: string;
  financial_year: string;
  closing_stock_value: number;
  depreciation_total: number;
  provisions_total: number;
  current_tax: number;
  deferred_tax: number;
  profit_before_tax: number;
  profit_after_tax: number;
  retained_earnings: number;
  journal_entries_created: number;
  opening_balances_created: number;
}

/**
 * Execute year closing:
 * 1. closing stock snapshot and depreciation for the year (posted to the GL);
 * 2. optional current-tax provision (Dr 5210 / Cr 2109) when a tax rate is given;
 * 3. one balanced closing voucher that zeroes every income and expense account to
 *    Retained Earnings (3002);
 * 4. opening balance snapshot, FY marked closed and the whole FY period locked.
 */
export async function executeYearClosing(
  businessId: string,
  financialYearId: string,
  financialYear: string,
  fyStartDate: string,
  fyEndDate: string,
  userId: string | null,
  taxRate: number = 0
): Promise<YearClosingResult> {
  const valuationRow = await queryOne<{ stock_valuation_method: string }>(
    `SELECT COALESCE(stock_valuation_method, 'fifo') AS stock_valuation_method
     FROM business_settings WHERE business_id = $1`,
    [businessId]
  );
  const valuationMethod = (valuationRow?.stock_valuation_method ?? 'fifo') as ClosingValuationMethod;
  const closingStock = await createClosingStockSnapshot(
    businessId,
    financialYearId,
    financialYear,
    fyEndDate,
    valuationMethod,
    userId ?? ''
  );

  const depreciationCalculations = await calculateDepreciationForAllAssets(
    businessId,
    financialYear,
    fyStartDate,
    fyEndDate
  );
  let depreciationTotal = 0;
  for (const calc of depreciationCalculations) {
    await saveDepreciationSchedule(calc, businessId, true);
    depreciationTotal += calc.depreciation_amount;
  }

  const provisions = await getTotalProvisions(businessId, financialYear);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const fy = await client.query(`SELECT is_closed FROM financial_years WHERE id = $1 FOR UPDATE`, [financialYearId]);
    if (fy.rows[0]?.is_closed) throw new Error(`FY ${financialYear} is already closed`);

    const profitBeforeTax = await ledgerProfit(client, businessId, fyStartDate, fyEndDate);

    let currentTaxAmount = 0;
    await deleteVoucher(client, businessId, financialYearId, 'tax_provision', 'regenerate:tax_provision', userId);
    if (taxRate > 0 && profitBeforeTax > 0) {
      currentTaxAmount = round2(calculateCurrentTax(profitBeforeTax, taxRate));
      const taxExpense = await requireAccountByCode(client, businessId, '5210', 'Current Tax Expense');
      const taxPayable = await requireAccountByCode(client, businessId, '2109', 'Current Tax Payable');
      const label = `Provision for current tax FY ${financialYear} @ ${taxRate}%`;
      await insertVoucherLines(client, {
        businessId,
        branchId: null,
        voucherId: financialYearId,
        voucherType: 'tax_provision',
        entryDate: fyEndDate,
        reference: `TAX-${financialYear}`,
        lines: [
          { accountId: taxExpense, debit: currentTaxAmount, credit: 0, narration: label },
          { accountId: taxPayable, debit: 0, credit: currentTaxAmount, narration: label },
        ],
      });
      await createOrUpdateTaxProvision(
        businessId,
        financialYear,
        'current_tax',
        currentTaxAmount,
        taxPayable,
        taxExpense,
        taxRate,
        profitBeforeTax,
        'flat_rate'
      );
    }

    const closing = await postYearClosingVoucher(client, {
      businessId,
      financialYearId,
      yearCode: financialYear,
      startDate: fyStartDate,
      endDate: fyEndDate,
    });

    const openingBalancesCreated = await createOpeningBalances(client, businessId, financialYearId, fyEndDate);

    await client.query(
      `UPDATE financial_years
       SET is_closed = true, closed_at = CURRENT_TIMESTAMP, closed_by = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [userId, financialYearId]
    );
    await client.query(
      `INSERT INTO period_locks (business_id, branch_id, financial_year, period_start, period_end, is_locked, locked_at, locked_by, notes)
       SELECT $1, NULL, $2, $3, $4, true, CURRENT_TIMESTAMP, $5, 'Locked by year closing'
       WHERE NOT EXISTS (
         SELECT 1 FROM period_locks
          WHERE business_id = $1 AND branch_id IS NULL AND period_start = $3 AND period_end = $4
       )`,
      [businessId, financialYear, fyStartDate, fyEndDate, userId]
    );
    await client.query(
      `UPDATE period_locks SET is_locked = true, locked_at = CURRENT_TIMESTAMP, locked_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $1 AND branch_id IS NULL AND period_start = $2 AND period_end = $3`,
      [businessId, fyStartDate, fyEndDate, userId]
    );

    await client.query('COMMIT');

    const profitAfterTax = round2(closing.profit);
    return {
      financial_year_id: financialYearId,
      financial_year: financialYear,
      closing_stock_value: closingStock.total_value,
      depreciation_total: depreciationTotal,
      provisions_total: provisions.total,
      current_tax: currentTaxAmount,
      deferred_tax: 0,
      profit_before_tax: profitBeforeTax,
      profit_after_tax: profitAfterTax,
      retained_earnings: profitAfterTax,
      journal_entries_created: closing.lines > 0 ? 1 : 0,
      opening_balances_created: openingBalancesCreated,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Net profit from the ledger (income - expense) for the FY, before the closing voucher. */
async function ledgerProfit(client: PoolClient, businessId: string, fromDate: string, toDate: string): Promise<number> {
  const res = await client.query(
    `SELECT COALESCE(SUM(l.credit - l.debit), 0) AS profit
       FROM ledger_entry_lines l
       JOIN accounts a ON a.id = l.account_id
      WHERE l.business_id = $1
        AND a.account_type IN ('income', 'expense')
        AND l.entry_date >= $2::date AND l.entry_date <= $3::date
        AND l.voucher_type NOT IN ('year_close', 'tax_provision')`,
    [businessId, fromDate, toDate]
  );
  return round2(Number(res.rows[0]?.profit || 0));
}

/**
 * Create opening balances for next financial year
 */
async function createOpeningBalances(
  client: any,
  businessId: string,
  currentFinancialYearId: string,
  asOnDate: string
): Promise<number> {
  // Get all account balances as of year end
  const accounts = await client.query(
    `SELECT 
      a.id,
      a.account_code,
      a.account_name,
      a.account_type,
      a.nature,
      get_account_balance(a.id, a.business_id, $1, NULL::uuid) as balance
    FROM accounts a
    WHERE a.business_id = $2
      AND a.is_active = true
      AND a.account_type IN ('asset', 'liability', 'capital')
    ORDER BY a.account_code`,
    [asOnDate, businessId]
  );

  let created = 0;

  for (const account of accounts.rows) {
    const balance = parseFloat(account.balance || 0);
    
    if (Math.abs(balance) < 0.01) continue; // Skip zero balances

    const balanceType = account.nature === 'debit'
      ? (balance >= 0 ? 'debit' : 'credit')
      : (balance >= 0 ? 'credit' : 'debit');

    // Insert opening balance
    await client.query(
      `INSERT INTO opening_balances (
        business_id,
        financial_year_id,
        account_id,
        opening_balance,
        opening_balance_type
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (business_id, financial_year_id, account_id)
      DO UPDATE SET
        opening_balance = EXCLUDED.opening_balance,
        opening_balance_type = EXCLUDED.opening_balance_type`,
      [
        businessId,
        currentFinancialYearId,
        account.id,
        Math.abs(balance),
        balanceType,
      ]
    );

    created++;
  }

  return created;
}

/**
 * Validate year closing prerequisites
 */
export async function validateYearClosing(
  businessId: string,
  financialYear: string
): Promise<{
  valid: boolean;
  errors: string[];
  warnings: string[];
}> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if closing stock is finalized
  const closingStockFinalized = await queryOne<{ is_finalized: boolean }>(
    `SELECT is_finalized FROM closing_stock_summary
     WHERE business_id = $1 AND financial_year = $2`,
    [businessId, financialYear]
  );

  if (!closingStockFinalized?.is_finalized) {
    warnings.push('Closing stock snapshot is not finalized; one will be taken at the FY end date during closing');
  }

  const fy = await queryOne<{ is_closed: boolean }>(
    `SELECT is_closed FROM financial_years WHERE business_id = $1 AND year_code = $2`,
    [businessId, financialYear]
  );
  if (fy?.is_closed) errors.push(`FY ${financialYear} is already closed`);

  // Check if all depreciation is posted
  const unpostedDepreciation = await queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM depreciation_schedule
     WHERE business_id = $1 
       AND financial_year = $2
       AND is_posted = false`,
    [businessId, financialYear]
  );

  if (unpostedDepreciation && parseInt(String(unpostedDepreciation.count || 0)) > 0) {
    warnings.push(`${unpostedDepreciation.count} depreciation entries are not posted`);
  }

  // Check if provisions are created
  const provisions = await getTotalProvisions(businessId, financialYear);
  if (provisions.total === 0) {
    warnings.push('No provisions created for this financial year');
  }

  // Check if tax provisions are created
  const taxProvisions = await getAllTaxProvisions(businessId, financialYear);
  if (!taxProvisions.current_tax) {
    warnings.push('Current tax provision is not created');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

