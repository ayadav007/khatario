/**
 * Year Closing Service
 * Executes complete financial year closing process
 */

import { queryRows, queryOne, getPool } from '@/lib/db';
import {
  createClosingStockSnapshot,
  type ClosingValuationMethod,
} from './closing-stock-valuator';
import { calculateDepreciationForAllAssets, saveDepreciationSchedule } from './depreciation-calculator';
import { getTotalProvisions } from './provisions-manager';
import { getAllTaxProvisions, createOrUpdateTaxProvision, calculateCurrentTax } from './tax-provision-calculator';
import { createLedgerEntryLine } from '@/lib/ledger-utils';
import { getAccountByCode } from '@/lib/ledger-utils';

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
 * Execute year closing process
 */
export async function executeYearClosing(
  businessId: string,
  financialYearId: string,
  financialYear: string,
  fyStartDate: string,
  fyEndDate: string,
  userId: string,
  taxRate: number = 30 // Default 30% tax rate
): Promise<YearClosingResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Create closing stock snapshot
    const valuationRow = await queryOne<{ stock_valuation_method: string }>(
      `SELECT COALESCE(stock_valuation_method, 'fifo') AS stock_valuation_method
       FROM business_settings WHERE business_id = $1`,
      [businessId]
    );
    const valuationMethod = (valuationRow?.stock_valuation_method ??
      'fifo') as ClosingValuationMethod;
    const closingStock = await createClosingStockSnapshot(
      businessId,
      financialYearId,
      financialYear,
      fyEndDate,
      valuationMethod,
      userId
    );

    // 2. Calculate and post depreciation for the year
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

    // 3. Get provisions total
    const provisions = await getTotalProvisions(businessId, financialYear);
    const provisionsTotal = provisions.total;

    // 4. Calculate P&L to get profit before tax
    const profitBeforeTax = await calculateProfitBeforeTax(
      client,
      businessId,
      fyStartDate,
      fyEndDate,
      closingStock.total_value,
      depreciationTotal
    );

    // 5. Calculate and create tax provisions
    const currentTaxAmount = calculateCurrentTax(profitBeforeTax, taxRate);
    
    // Get tax accounts
    const currentTaxAccount = await getAccountByCode(businessId, '2109'); // Current Tax Payable
    const taxExpenseAccount = await getAccountByCode(businessId, '5210'); // Current Tax Expense

    if (currentTaxAccount && taxExpenseAccount) {
      await createOrUpdateTaxProvision(
        businessId,
        financialYear,
        'current_tax',
        currentTaxAmount,
        currentTaxAccount.id,
        taxExpenseAccount.id,
        taxRate,
        profitBeforeTax,
        'flat_rate'
      );
    }

    // Deferred tax (simplified - should be calculated from timing differences)
    const deferredTaxAmount = 0; // Placeholder - implement based on timing differences

    const profitAfterTax = profitBeforeTax - currentTaxAmount - deferredTaxAmount;

    // 6. Transfer P&L to Retained Earnings
    const retainedEarningsAccount = await getAccountByCode(businessId, '3002'); // Retained Earnings
    let journalEntriesCreated = 0;

    if (retainedEarningsAccount) {
      // Create journal entry: Debit P&L accounts, Credit Retained Earnings (if profit)
      // Or: Debit Retained Earnings, Credit P&L accounts (if loss)
      
      if (profitAfterTax > 0) {
        // Profit: Transfer to Retained Earnings
        // This is a simplified version - in practice, you'd close all income/expense accounts
        const voucherId = crypto.randomUUID();
        
        // Debit: Income accounts (closing)
        // Credit: Retained Earnings
        await createLedgerEntryLine({
          businessId,
          voucherId,
          voucherType: 'journal',
          accountId: retainedEarningsAccount.id,
          entryDate: fyEndDate,
          debit: 0,
          credit: profitAfterTax,
          narration: `Year closing - Profit transferred to Retained Earnings for FY ${financialYear}`,
          referenceNumber: `YC-${financialYear}`,
        });

        journalEntriesCreated++;
      } else if (profitAfterTax < 0) {
        // Loss: Transfer from Retained Earnings
        const voucherId = crypto.randomUUID();
        
        await createLedgerEntryLine({
          businessId,
          voucherId,
          voucherType: 'journal',
          accountId: retainedEarningsAccount.id,
          entryDate: fyEndDate,
          debit: Math.abs(profitAfterTax),
          credit: 0,
          narration: `Year closing - Loss transferred from Retained Earnings for FY ${financialYear}`,
          referenceNumber: `YC-${financialYear}`,
        });

        journalEntriesCreated++;
      }
    }

    // 7. Create opening balances for next financial year
    const openingBalancesCreated = await createOpeningBalances(
      client,
      businessId,
      financialYearId,
      fyEndDate
    );

    // 8. Mark financial year as closed
    await client.query(
      `UPDATE financial_years
       SET is_closed = true,
           closed_at = CURRENT_TIMESTAMP,
           closed_by = $1
       WHERE id = $2`,
      [userId, financialYearId]
    );

    await client.query('COMMIT');

    return {
      financial_year_id: financialYearId,
      financial_year: financialYear,
      closing_stock_value: closingStock.total_value,
      depreciation_total: depreciationTotal,
      provisions_total: provisionsTotal,
      current_tax: currentTaxAmount,
      deferred_tax: deferredTaxAmount,
      profit_before_tax: profitBeforeTax,
      profit_after_tax: profitAfterTax,
      retained_earnings: profitAfterTax,
      journal_entries_created: journalEntriesCreated,
      opening_balances_created: openingBalancesCreated,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Calculate profit before tax from P&L
 */
async function calculateProfitBeforeTax(
  client: any,
  businessId: string,
  fromDate: string,
  toDate: string,
  closingStockValue: number,
  depreciation: number
): Promise<number> {
  // Get total income
  const income = await client.query(
    `SELECT COALESCE(SUM(credit - debit), 0) as total
     FROM ledger_entry_lines lel
     JOIN accounts a ON lel.account_id = a.id
     WHERE lel.business_id = $1
       AND lel.entry_date >= $2
       AND lel.entry_date <= $3
       AND a.account_type = 'income'`,
    [businessId, fromDate, toDate]
  );

  // Get total expenses (excluding depreciation which is passed separately)
  const expenses = await client.query(
    `SELECT COALESCE(SUM(debit - credit), 0) as total
     FROM ledger_entry_lines lel
     JOIN accounts a ON lel.account_id = a.id
     WHERE lel.business_id = $1
       AND lel.entry_date >= $2
       AND lel.entry_date <= $3
       AND a.account_type = 'expense'
       AND a.account_code != '5204'`, // Exclude depreciation (already included)
    [businessId, fromDate, toDate]
  );

  const totalIncome = parseFloat(income.rows[0]?.total || 0);
  const totalExpenses = parseFloat(expenses.rows[0]?.total || 0);

  // Calculate COGS: Opening Stock + Purchases - Closing Stock
  // For simplicity, using purchases directly (opening stock should be from previous FY)
  const purchases = await client.query(
    `SELECT COALESCE(SUM(grand_total), 0) as total
     FROM purchases
     WHERE business_id = $1
       AND bill_date >= $2
       AND bill_date <= $3
       AND status != 'cancelled'`,
    [businessId, fromDate, toDate]
  );

  const totalPurchases = parseFloat(purchases.rows[0]?.total || 0);
  // Note: Opening stock should come from previous FY closing stock
  // For now, assuming 0 opening stock for first year
  const openingStockValue = 0; // Should be fetched from previous FY
  const cogs = openingStockValue + totalPurchases - closingStockValue;

  // Profit = Income - COGS - Expenses - Depreciation
  const profit = totalIncome - cogs - totalExpenses - depreciation;

  return profit;
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
    errors.push('Closing stock snapshot is not finalized');
  }

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

