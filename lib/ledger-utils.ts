/**
 * Ledger Utilities
 * Helper functions for creating ledger entries and getting default accounts
 */

import type { PoolClient } from 'pg';
import * as db from '@/lib/db';
import { Account } from '@/types/database';

/** Use the same PoolClient as an outer BEGIN so deferred voucher-balance triggers see all lines at COMMIT. */
async function ledgerQueryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  poolClient: PoolClient | undefined,
  text: string,
  params?: unknown[]
): Promise<T | null> {
  if (poolClient) {
    const res = await poolClient.query<T>(text, params);
    return res.rows[0] ?? null;
  }
  return db.queryOne<T>(text, params);
}

async function ledgerQueryRows<T extends Record<string, unknown> = Record<string, unknown>>(
  poolClient: PoolClient | undefined,
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (poolClient) {
    const res = await poolClient.query<T>(text, params);
    return res.rows;
  }
  return db.queryRows<T>(text, params);
}

/**
 * Get account by ID
 */
export async function getAccountById(
  businessId: string,
  accountId: string
): Promise<Account | null> {
  try {
    const account = await db.queryOne<Account>(
      `SELECT * FROM accounts 
       WHERE business_id = $1 AND id = $2 AND is_active = true`,
      [businessId, accountId]
    );
    return account;
  } catch (error) {
    console.error(`Error getting account by ID ${accountId}:`, error);
    return null;
  }
}

/**
 * Get default account by account code
 */
export async function getAccountByCode(
  businessId: string,
  accountCode: string
): Promise<Account | null> {
  try {
    const account = await db.queryOne<Account>(
      `SELECT * FROM accounts 
       WHERE business_id = $1 AND account_code = $2 AND is_active = true`,
      [businessId, accountCode]
    );
    return account;
  } catch (error) {
    console.error(`Error getting account ${accountCode}:`, error);
    return null;
  }
}

/**
 * Get default account by account name (fuzzy match)
 */
export async function getAccountByName(
  businessId: string,
  accountName: string
): Promise<Account | null> {
  try {
    const account = await db.queryOne<Account>(
      `SELECT * FROM accounts 
       WHERE business_id = $1 
       AND LOWER(account_name) = LOWER($2) 
       AND is_active = true
       LIMIT 1`,
      [businessId, accountName]
    );
    return account;
  } catch (error) {
    console.error(`Error getting account by name ${accountName}:`, error);
    return null;
  }
}

/**
 * Get default accounts for a business
 * Uses configured account mappings if available, otherwise falls back to default lookup
 */
export async function getDefaultAccounts(businessId: string): Promise<{
  sales?: Account;
  accountsReceivable?: Account;
  cash?: Account;
  bank?: Account;
  purchases?: Account;
  accountsPayable?: Account;
  inventory?: Account;
  cogs?: Account;
  expenses?: Account;
  // PHASE-3: GST split accounts. Output = liability (we owe gov), Input = asset (gov owes us).
  // Resolved by code only (no user-overridable mapping); business setup populates them via
  // ensure_phase3_gst_accounts() in migration 166.
  outputCgst?: Account;
  outputSgst?: Account;
  outputIgst?: Account;
  outputCess?: Account;
  inputCgst?: Account;
  inputSgst?: Account;
  inputIgst?: Account;
  inputCess?: Account;
  rcmOutput?: Account;
  rcmInput?: Account;
  gstNetSettlement?: Account;
  itcSuspense?: Account;
}> {
  
  const defaults: any = {};

  // Try to use configured account mappings first
  try {
    
    const { getMappedAccountId } = await import('@/lib/account-mappings');
    
    
    const salesAccountId = await getMappedAccountId(businessId, 'sales_account_id', '4101', 'Sales');
    if (salesAccountId) {
      defaults.sales = await getAccountById(businessId, salesAccountId);
    }

    const receivablesAccountId = await getMappedAccountId(businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable');
    if (receivablesAccountId) {
      defaults.accountsReceivable = await getAccountById(businessId, receivablesAccountId);
    }

    const cashAccountId = await getMappedAccountId(businessId, 'cash_account_id', '1101', 'Cash');
    if (cashAccountId) {
      defaults.cash = await getAccountById(businessId, cashAccountId);
    }

    const bankAccountId = await getMappedAccountId(businessId, 'bank_account_id', '1102', 'Bank Account');
    if (bankAccountId) {
      defaults.bank = await getAccountById(businessId, bankAccountId);
    }

    const purchasesAccountId = await getMappedAccountId(businessId, 'purchases_account_id', '5101', 'Purchases');
    if (purchasesAccountId) {
      defaults.purchases = await getAccountById(businessId, purchasesAccountId);
    }

    const payablesAccountId = await getMappedAccountId(businessId, 'accounts_payable_account_id', '2101', 'Accounts Payable');
    if (payablesAccountId) {
      defaults.accountsPayable = await getAccountById(businessId, payablesAccountId);
    }

    const inventoryAccountId = await getMappedAccountId(businessId, 'inventory_account_id', '1104', 'Inventory');
    if (inventoryAccountId) {
      defaults.inventory = await getAccountById(businessId, inventoryAccountId);
    }

    const cogsAccountId = await getMappedAccountId(businessId, 'cogs_account_id', '5101', 'Cost of Goods Sold');
    if (cogsAccountId) {
      defaults.cogs = await getAccountById(businessId, cogsAccountId);
    }

    const expenseAccountId = await getMappedAccountId(businessId, 'expense_account_id', '5201', 'Administrative Expenses');
    if (expenseAccountId) {
      defaults.expenses = await getAccountById(businessId, expenseAccountId);
    }
  } catch (error) {
    console.warn('Error using account mappings, falling back to default lookup:', error);
  }

  // Fallback to default lookup if mappings not found
  if (!defaults.sales) {
    defaults.sales = await getAccountByCode(businessId, '4101') || 
                     await getAccountByName(businessId, 'Sales');
  }
  
  if (!defaults.accountsReceivable) {
    defaults.accountsReceivable = await getAccountByCode(businessId, '1103') || 
                                  await getAccountByName(businessId, 'Accounts Receivable');
  }
  
  if (!defaults.cash) {
    defaults.cash = await getAccountByCode(businessId, '1101') || 
                    await getAccountByName(businessId, 'Cash');
  }
  
  if (!defaults.bank) {
    defaults.bank = await getAccountByCode(businessId, '1102') || 
                    await getAccountByName(businessId, 'Bank Account');
  }
  
  if (!defaults.purchases) {
    defaults.purchases = await getAccountByCode(businessId, '5101') || 
                         await getAccountByName(businessId, 'Purchases');
  }
  
  if (!defaults.accountsPayable) {
    defaults.accountsPayable = await getAccountByCode(businessId, '2101') || 
                               await getAccountByName(businessId, 'Accounts Payable');
  }
  
  if (!defaults.inventory) {
    defaults.inventory = await getAccountByCode(businessId, '1104') || 
                         await getAccountByName(businessId, 'Inventory');
  }
  
  if (!defaults.cogs) {
    defaults.cogs = await getAccountByCode(businessId, '5101') || 
                    await getAccountByName(businessId, 'Cost of Goods Sold') ||
                    await getAccountByName(businessId, 'Purchases');
  }
  
  if (!defaults.expenses) {
    defaults.expenses = await getAccountByCode(businessId, '5201') || 
                        await getAccountByName(businessId, 'Administrative Expenses');
  }

  // ------------------------------------------------------------------
  // PHASE-3: GST split accounts (created by migration 166).
  // We resolve in parallel because every invoice/purchase post needs them.
  // No name-based fallback — these codes are reserved system accounts and
  // anything else would silently break the split.
  // ------------------------------------------------------------------
  const [
    outputCgst, outputSgst, outputIgst, outputCess,
    inputCgst, inputSgst, inputIgst, inputCess,
    rcmOutput, rcmInput, gstNetSettlement, itcSuspense,
  ] = await Promise.all([
    getAccountByCode(businessId, '2150'),
    getAccountByCode(businessId, '2151'),
    getAccountByCode(businessId, '2152'),
    getAccountByCode(businessId, '2153'),
    getAccountByCode(businessId, '1110'),
    getAccountByCode(businessId, '1111'),
    getAccountByCode(businessId, '1112'),
    getAccountByCode(businessId, '1113'),
    getAccountByCode(businessId, '2155'),
    getAccountByCode(businessId, '1115'),
    getAccountByCode(businessId, '2154'),
    getAccountByCode(businessId, '1114'),
  ]);

  if (outputCgst) defaults.outputCgst = outputCgst;
  if (outputSgst) defaults.outputSgst = outputSgst;
  if (outputIgst) defaults.outputIgst = outputIgst;
  if (outputCess) defaults.outputCess = outputCess;
  if (inputCgst) defaults.inputCgst = inputCgst;
  if (inputSgst) defaults.inputSgst = inputSgst;
  if (inputIgst) defaults.inputIgst = inputIgst;
  if (inputCess) defaults.inputCess = inputCess;
  if (rcmOutput) defaults.rcmOutput = rcmOutput;
  if (rcmInput) defaults.rcmInput = rcmInput;
  if (gstNetSettlement) defaults.gstNetSettlement = gstNetSettlement;
  if (itcSuspense) defaults.itcSuspense = itcSuspense;

  return defaults;
}

/**
 * Get account for payment mode (Cash, Bank, UPI, etc.)
 * Uses configured payment mode mappings if available
 */
export async function getAccountForPaymentMode(
  businessId: string,
  paymentMode: string
): Promise<Account | null> {
  try {
    // Try to use configured payment mode mapping
    const { getPaymentModeAccountId } = await import('@/lib/account-mappings');
    const accountId = await getPaymentModeAccountId(businessId, paymentMode);
    
    if (accountId) {
      const account = await getAccountById(businessId, accountId);
      if (account) return account;
    }
  } catch (error) {
    console.warn('Error using payment mode mapping, falling back to default:', error);
  }

  // Fallback to default lookup
  const mode = paymentMode?.toLowerCase() || 'cash';
  
  if (mode === 'cash') {
    return await getAccountByCode(businessId, '1101') || 
           await getAccountByName(businessId, 'Cash');
  }
  
  if (mode === 'bank' || mode === 'bank_transfer' || mode === 'neft' || mode === 'rtgs') {
    return await getAccountByCode(businessId, '1102') || 
           await getAccountByName(businessId, 'Bank Account');
  }

  if (mode === 'upi' || mode === 'credit_card' || mode === 'card' || mode === 'cheque') {
    return (
      (await getAccountByCode(businessId, '1102')) ||
      (await getAccountByName(businessId, 'Bank Account')) ||
      (await getAccountByCode(businessId, '1101')) ||
      (await getAccountByName(businessId, 'Cash'))
    );
  }
  
  // Other modes: prefer Cash, then Bank
  return await getAccountByCode(businessId, '1101') || 
         await getAccountByName(businessId, 'Cash') ||
         (await getAccountByCode(businessId, '1102')) ||
         (await getAccountByName(businessId, 'Bank Account'));
}

/**
 * Get or create Opening Balance Adjustment account
 * This is a system account used for posting opening balances
 */
export async function getOrCreateOpeningBalanceAdjustmentAccount(
  businessId: string
): Promise<Account> {
  // Try to get existing account
  let account = await getAccountByCode(businessId, '3100') ||
                await getAccountByName(businessId, 'Opening Balance Adjustment');

  if (account) {
    return account;
  }

  // Account doesn't exist - create it
  // First, get or create Capital account group
  let capitalGroup = await db.queryOne<{ id: string }>(`
    SELECT id FROM account_groups 
    WHERE business_id = $1 AND group_code = '3000' AND group_type = 'capital'
    LIMIT 1
  `, [businessId]);

  if (!capitalGroup) {
    // Create Capital group if it doesn't exist
    capitalGroup = await db.queryOne<{ id: string }>(`
      INSERT INTO account_groups (business_id, group_code, group_name, group_type, is_system, sort_order)
      VALUES ($1, '3000', 'Capital', 'capital', true, 3)
      ON CONFLICT (business_id, group_code) DO UPDATE SET group_name = EXCLUDED.group_name
      RETURNING id
    `, [businessId]);
  }

  if (!capitalGroup) {
    throw new Error('Failed to get or create Capital account group');
  }

  // Create Opening Balance Adjustment account
  account = await db.queryOne<Account>(`
    INSERT INTO accounts (
      business_id, account_code, account_name, account_type, account_group_id,
      nature, is_system, sort_order, description
    )
    VALUES ($1, '3100', 'Opening Balance Adjustment', 'capital', $2, 'credit', true, 1, 'System account for opening balance adjustments')
    RETURNING *
  `, [businessId, capitalGroup.id]);

  if (!account) {
    throw new Error('Failed to create Opening Balance Adjustment account');
  }

  return account;
}

/**
 * Get current financial year start date for a business
 * Returns April 1 of current year if no financial year exists (Indian FY standard)
 */
export async function getFinancialYearStartDate(businessId: string): Promise<Date> {
  // Try to get current financial year
  const currentYear = await db.queryOne<{ start_date: string }>(`
    SELECT start_date FROM financial_years
    WHERE business_id = $1 
      AND is_closed = false
      AND start_date <= CURRENT_DATE
      AND end_date >= CURRENT_DATE
    ORDER BY start_date DESC
    LIMIT 1
  `, [businessId]);

  if (currentYear?.start_date) {
    return new Date(currentYear.start_date);
  }

  // No financial year found - use Indian FY standard (April 1 of current year)
  const today = new Date();
  const currentMonth = today.getMonth(); // 0-11
  const currentYearNum = today.getFullYear();
  
  // If current month is Jan-Mar, FY started in previous year
  // Otherwise, FY started this year
  const fyYear = currentMonth < 3 ? currentYearNum - 1 : currentYearNum;
  return new Date(fyYear, 3, 1); // April 1
}

/**
 * Check if a customer has any transactions (invoices or payments)
 * Used to determine if opening balance can be modified
 */
export async function customerHasTransactions(customerId: string): Promise<boolean> {
  const result = await db.queryOne<{ count: number }>(`
    SELECT 
      (SELECT COUNT(*) FROM invoices WHERE customer_id = $1 AND status != 'cancelled' AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM payments WHERE customer_id = $1 AND type = 'receivable' AND deleted_at IS NULL) as count
  `, [customerId]);

  return (result?.count ?? 0) > 0;
}

/**
 * Check if a supplier has any transactions (purchases or payments)
 * Used to determine if opening balance can be modified
 */
export async function supplierHasTransactions(supplierId: string): Promise<boolean> {
  const result = await db.queryOne<{ count: number }>(`
    SELECT 
      (SELECT COUNT(*) FROM purchases WHERE supplier_id = $1 AND status != 'cancelled' AND deleted_at IS NULL) +
      (SELECT COUNT(*) FROM payments WHERE supplier_id = $1 AND type = 'payable' AND deleted_at IS NULL) as count
  `, [supplierId]);

  return (result?.count ?? 0) > 0;
}

/**
 * Post opening balance ledger entry for a customer or supplier
 * Creates double-entry journal entry: Dr/Cr Party Account, Cr/Dr Opening Balance Adjustment
 * IMPORTANT: Only posts once - checks if entry already exists to avoid duplicates
 */
export async function postOpeningBalanceLedgerEntry(params: {
  businessId: string;
  entityType: 'customer' | 'supplier';
  entityId: string;
  entityName: string;
  openingBalance: number;
  openingBalanceType: 'debit' | 'credit';
}): Promise<void> {
  const {
    businessId,
    entityType,
    entityId,
    entityName,
    openingBalance,
    openingBalanceType,
  } = params;

  // Skip if opening balance is zero
  if (openingBalance === 0) {
    return;
  }

  // Check if opening balance ledger entry already exists (prevent duplicates)
  const existingEntry = await db.queryOne<{ id: string }>(`
    SELECT id FROM ledger_entry_lines
    WHERE business_id = $1
      AND voucher_id = $2
      AND voucher_type = 'opening_balance'
    LIMIT 1
  `, [businessId, entityId]);

  if (existingEntry) {
    // Entry already exists - do not post again (opening balance must be posted only once)
    return;
  }

  // Get accounts
  const accounts = await getDefaultAccounts(businessId);
  const openingBalanceAccount = await getOrCreateOpeningBalanceAdjustmentAccount(businessId);
  const fyStartDate = await getFinancialYearStartDate(businessId);

  // Determine party account (Accounts Receivable for customers, Accounts Payable for suppliers)
  const partyAccount = entityType === 'customer' 
    ? accounts.accountsReceivable 
    : accounts.accountsPayable;

  if (!partyAccount) {
    throw new Error(
      entityType === 'customer' 
        ? 'Accounts Receivable account not found. Please set up chart of accounts.'
        : 'Accounts Payable account not found. Please set up chart of accounts.'
    );
  }

  // Create voucher ID (use entity ID as voucher_id for opening balance entries)
  const voucherId = entityId;

  // Determine debit/credit based on opening balance type and entity type
  let partyDebit = 0;
  let partyCredit = 0;
  let adjustmentDebit = 0;
  let adjustmentCredit = 0;

  if (entityType === 'customer') {
    if (openingBalanceType === 'debit') {
      // Customer debit: Dr Accounts Receivable, Cr Opening Balance Adjustment
      partyDebit = openingBalance;
      adjustmentCredit = openingBalance;
    } else {
      // Customer credit: Cr Accounts Receivable, Dr Opening Balance Adjustment
      partyCredit = openingBalance;
      adjustmentDebit = openingBalance;
    }
  } else {
    // Supplier
    if (openingBalanceType === 'credit') {
      // Supplier credit: Cr Accounts Payable, Dr Opening Balance Adjustment
      partyCredit = openingBalance;
      adjustmentDebit = openingBalance;
    } else {
      // Supplier debit: Dr Accounts Payable, Cr Opening Balance Adjustment
      partyDebit = openingBalance;
      adjustmentCredit = openingBalance;
    }
  }

  // Create ledger entries (double-entry)
  // Entry 1: Party Account
  await createLedgerEntryLine({
    businessId,
    voucherId,
    voucherType: 'opening_balance',
    accountId: partyAccount.id,
    entryDate: fyStartDate,
    debit: partyDebit,
    credit: partyCredit,
    narration: `Opening balance - ${entityName}`,
    referenceNumber: entityName,
    branchId: undefined, // Business-level, not branch-specific
  });

  // Entry 2: Opening Balance Adjustment Account
  await createLedgerEntryLine({
    businessId,
    voucherId,
    voucherType: 'opening_balance',
    accountId: openingBalanceAccount.id,
    entryDate: fyStartDate,
    debit: adjustmentDebit,
    credit: adjustmentCredit,
    narration: `Opening balance adjustment - ${entityName}`,
    referenceNumber: entityName,
    branchId: undefined, // Business-level, not branch-specific
  });
}

/**
 * Create a ledger entry line
 */
export async function createLedgerEntryLine(params: {
  businessId: string;
  voucherId: string;
  voucherType:
    | 'invoice'
    | 'payment'
    | 'purchase'
    | 'expense'
    | 'journal'
    | 'opening_balance'
    | 'credit_note'
    | 'purchase_return'
    | 'debit_note'
    | 'gst_setoff'
    | 'gst_payment';
  accountId: string;
  entryDate: Date | string;
  debit: number;
  credit: number;
  narration?: string;
  referenceNumber?: string;
  branchId?: string; // Branch ID for branch-wise accounting
  /** When set, all queries run on this client (must be inside caller BEGIN … COMMIT). */
  poolClient?: PoolClient;
}): Promise<string> {
  
  const {
    businessId,
    voucherId,
    voucherType,
    accountId,
    entryDate,
    debit,
    credit,
    narration,
    referenceNumber,
    branchId,
    poolClient,
  } = params;

  // Validate: either debit or credit must be > 0, not both
  if (debit > 0 && credit > 0) {
    throw new Error('Cannot have both debit and credit > 0');
  }
  if (debit === 0 && credit === 0) {
    throw new Error('Either debit or credit must be > 0');
  }

  // CRITICAL: For transactional entries (not opening_balance), branch_id is MANDATORY
  // Opening balances are business-level and should NOT have branch_id
  const isTransactionalEntry = voucherType !== 'opening_balance';
  
  if (isTransactionalEntry && !branchId) {
    throw new Error(`branch_id is required for transactional ledger entries (voucher_type: ${voucherType}). Only opening_balance entries can have NULL branch_id.`);
  }
  
  // Validate branch_id if provided
  if (branchId) {
    const branchCheck = await ledgerQueryOne<{ id: string; is_active: boolean }>(poolClient, `
      SELECT id, is_active FROM branches 
      WHERE id = $1 AND business_id = $2
    `, [branchId, businessId]);
    
    if (!branchCheck) {
      throw new Error(`Branch ${branchId} not found for business ${businessId}`);
    }
    
    if (!branchCheck.is_active) {
      throw new Error(`Cannot create ledger entry for inactive branch ${branchId}`);
    }
  }

  // Validate account belongs to same business and check nature
  
  const accountCheck = await ledgerQueryOne<{ business_id: string; nature: 'debit' | 'credit'; account_name: string }>(poolClient, `
    SELECT business_id, nature, account_name FROM accounts WHERE id = $1
  `, [accountId]);
  
  
  if (!accountCheck) {
    throw new Error(`Account ${accountId} not found`);
  }
  
  if (accountCheck.business_id !== businessId) {
    throw new Error(`Account ${accountId} does not belong to business ${businessId}`);
  }
  
  // If branch_id provided, ensure account's business matches branch's business
  if (branchId && accountCheck.business_id !== businessId) {
    throw new Error(`Account ${accountId} and branch ${branchId} must belong to the same business`);
  }

  // CRITICAL: Validate account nature vs debit/credit
  // Debit-nature accounts (Assets, Expenses): Increase with debit, decrease with credit
  // Credit-nature accounts (Liabilities, Income, Capital): Increase with credit, decrease with debit
  // For normal entries (not reversals), validate nature matches entry type
  const isReversal = voucherType === 'journal' && narration?.toLowerCase().includes('reversal');
  
  if (!isReversal) {
    // Normal entry: debit-nature accounts should have debit, credit-nature accounts should have credit
    if (accountCheck.nature === 'debit' && debit === 0 && credit > 0) {
      // Warning: Crediting a debit-nature account (decrease) - this is unusual but allowed for adjustments
      console.warn(`Crediting debit-nature account "${accountCheck.account_name}" (${accountId}). This decreases the account balance.`);
    }
    
    if (accountCheck.nature === 'credit' && credit === 0 && debit > 0) {
      // Warning: Debiting a credit-nature account (decrease) - this is unusual but allowed for adjustments
      console.warn(`Debiting credit-nature account "${accountCheck.account_name}" (${accountId}). This decreases the account balance.`);
    }
    
    // For normal increases, validate nature matches
    // Note: We allow decreases (opposite nature) for adjustments, but warn
    // We don't block them as they may be legitimate (e.g., writing off bad debt)
  }

  
  const result = await ledgerQueryOne<{ id: string }>(
    poolClient,
    `INSERT INTO ledger_entry_lines (
      business_id, voucher_id, voucher_type, account_id, entry_date,
      debit, credit, narration, reference_number, branch_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      businessId,
      voucherId,
      voucherType,
      accountId,
      entryDate,
      debit || 0,
      credit || 0,
      narration || null,
      referenceNumber || null,
      branchId || null,
    ]
  );
  

  return result?.id || '';
}

/**
 * Create double-entry ledger entries for an invoice.
 *
 * PHASE-3 GST split: Sales is credited only the TAXABLE value; CGST/SGST/IGST/Cess
 * are credited to their own Output GST liability accounts. The receivable / cash
 * leg still hits grand_total. Falls back to the legacy single-line behaviour ONLY
 * if (a) no GST totals were passed OR (b) the GST split accounts haven't been
 * provisioned for this business (e.g., migration 166 hasn't run yet).
 */
export async function createInvoiceLedgerEntries(params: {
  businessId: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: Date | string;
  grandTotal: number;
  customerId?: string | null;
  paymentMode?: string;
  isCashSale: boolean;
  cogsAmount?: number; // Cost of Goods Sold amount (if inventory tracking)
  branchId?: string; // Branch ID for branch-wise accounting
  // PHASE-3: per-tax breakdowns from the invoice header. All optional so that
  // older callers (and bills-of-supply, exports without payment, etc.) work
  // unchanged when they pass 0 / undefined.
  taxableValue?: number;     // = invoice.subtotal (post-discount, pre-tax)
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  // PHASE-5: when caller already has an open BEGIN ... COMMIT, pass the same
  // PoolClient so all per-voucher INSERTs land in one transaction. The deferred
  // validate_voucher_balance() trigger (migration 123) only fires at COMMIT,
  // so without a shared client every single-row INSERT is its own auto-commit
  // tx and the trigger rejects the very first line as "Voucher is not balanced".
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    invoiceId,
    invoiceNumber,
    invoiceDate,
    grandTotal,
    customerId,
    isCashSale,
    cogsAmount = 0,
    taxableValue,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    poolClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  if (!accounts.sales) {
    throw new Error(
      `Sales account (4101) not found for business ${businessId}. ` +
      `Cannot post invoice ${invoiceNumber} to the ledger. ` +
      `Run the chart-of-accounts seed for this business.`,
    );
  }

  // ---- PHASE-3: decide whether to use the GST split or fall back to single-line ----
  const totalGst = (cgstTotal || 0) + (sgstTotal || 0) + (igstTotal || 0) + (cessTotal || 0);
  // Effective taxable value: explicit > derived (grand_total - GST).
  // We never trust an inconsistent caller — if grand_total - GST != taxableValue we
  // use grand_total - GST so the journal always balances.
  const derivedTaxable = Math.max(0, Number((grandTotal - totalGst).toFixed(2)));
  const salesCredit = totalGst > 0
    ? derivedTaxable
    : (taxableValue && taxableValue > 0 ? taxableValue : grandTotal);

  const splitAccountsReady =
    !!(accounts.outputCgst && accounts.outputSgst && accounts.outputIgst);

  if (totalGst > 0.005) {
    if (!splitAccountsReady) {
      throw new Error(
        'GST accounts not configured: output CGST/SGST/IGST (ledger codes 2150, 2151, 2152) are required when the invoice has GST. Run chart-of-accounts migration 166 or create these accounts.'
      );
    }
    if ((cessTotal || 0) > 0.005 && !accounts.outputCess) {
      throw new Error(
        'Output CESS account (2153) is not configured but this invoice includes CESS. Create account 2153 or remove CESS from the line items.'
      );
    }
  }

  const useGstSplit = totalGst > 0 && splitAccountsReady;

  // Entry 1: Debit Receivables/Cash for grand_total
  if (isCashSale || !customerId) {
    const cashAccount = accounts.cash || accounts.bank;
    if (!cashAccount) {
      throw new Error(
        `Cash/Bank account (1101/1102) not found for business ${businessId}. ` +
        `Cannot post cash sale invoice ${invoiceNumber}.`,
      );
    }
    await createLedgerEntryLine({
      businessId,
      voucherId: invoiceId,
      voucherType: 'invoice',
      accountId: cashAccount.id,
      entryDate: invoiceDate,
      debit: grandTotal,
      credit: 0,
      narration: `Cash sale - Invoice ${invoiceNumber}`,
      referenceNumber: invoiceNumber,
      branchId: params.branchId,
      poolClient,
    });
  } else {
    if (!accounts.accountsReceivable) {
      throw new Error(
        `Accounts Receivable account (1103) not found for business ${businessId}. ` +
        `Cannot post credit invoice ${invoiceNumber}.`,
      );
    }
    await createLedgerEntryLine({
      businessId,
      voucherId: invoiceId,
      voucherType: 'invoice',
      accountId: accounts.accountsReceivable.id,
      entryDate: invoiceDate,
      debit: grandTotal,
      credit: 0,
      narration: `Credit sale - Invoice ${invoiceNumber}`,
      referenceNumber: invoiceNumber,
      branchId: params.branchId,
      poolClient,
    });
  }

  // Entry 2: Credit Sales for taxable value (or grand_total in legacy mode)
  await createLedgerEntryLine({
    businessId,
    voucherId: invoiceId,
    voucherType: 'invoice',
    accountId: accounts.sales.id,
    entryDate: invoiceDate,
    debit: 0,
    credit: useGstSplit ? salesCredit : grandTotal,
    narration: useGstSplit
      ? `Sales (taxable) - Invoice ${invoiceNumber}`
      : `Sales - Invoice ${invoiceNumber}`,
    referenceNumber: invoiceNumber,
    branchId: params.branchId,
    poolClient,
  });

  // Entry 3 (PHASE-3): Credit Output GST accounts for each tax component
  if (useGstSplit) {
    if (cgstTotal > 0 && accounts.outputCgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: invoiceId,
        voucherType: 'invoice',
        accountId: accounts.outputCgst.id,
        entryDate: invoiceDate,
        debit: 0,
        credit: cgstTotal,
        narration: `Output CGST - Invoice ${invoiceNumber}`,
        referenceNumber: invoiceNumber,
        branchId: params.branchId,
        poolClient,
      });
    }
    if (sgstTotal > 0 && accounts.outputSgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: invoiceId,
        voucherType: 'invoice',
        accountId: accounts.outputSgst.id,
        entryDate: invoiceDate,
        debit: 0,
        credit: sgstTotal,
        narration: `Output SGST - Invoice ${invoiceNumber}`,
        referenceNumber: invoiceNumber,
        branchId: params.branchId,
        poolClient,
      });
    }
    if (igstTotal > 0 && accounts.outputIgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: invoiceId,
        voucherType: 'invoice',
        accountId: accounts.outputIgst.id,
        entryDate: invoiceDate,
        debit: 0,
        credit: igstTotal,
        narration: `Output IGST - Invoice ${invoiceNumber}`,
        referenceNumber: invoiceNumber,
        branchId: params.branchId,
        poolClient,
      });
    }
    if (cessTotal > 0 && accounts.outputCess) {
      await createLedgerEntryLine({
        businessId,
        voucherId: invoiceId,
        voucherType: 'invoice',
        accountId: accounts.outputCess.id,
        entryDate: invoiceDate,
        debit: 0,
        credit: cessTotal,
        narration: `Output Cess - Invoice ${invoiceNumber}`,
        referenceNumber: invoiceNumber,
        branchId: params.branchId,
        poolClient,
      });
    }
  }

  // PHASE-4: per-invoice COGS posting is DISABLED for periodic-inventory books.
  // Periodic books compute COGS at period end via the Trading Account formula:
  //     COGS = Opening Stock + Net Purchases (5101) − Purchase Returns (5102) − Closing Stock
  // Posting per-invoice COGS in a periodic system creates two parallel COGS sources
  // (the cogs_two_sources audit issue). Tally and Ind AS 2 both expect periodic
  // books to keep 5104 and 1104 untouched between year-end snapshots — only the
  // Year-End Close JV writes to them.
  // To switch a business to perpetual later: flip business_settings.inventory_model
  // and re-enable this block guarded by `inventoryModel === 'perpetual'`.
  if (cogsAmount > 0) {
    console.warn(
      `[PHASE-4] cogsAmount=₹${cogsAmount.toFixed(2)} ignored for invoice ${invoiceNumber} ` +
      `— inventory_model is periodic; COGS is computed at period end, not per invoice.`,
    );
  }
}

/**
 * Create double-entry ledger entries for a purchase
 */
export async function createPurchaseLedgerEntries(params: {
  businessId: string;
  purchaseId: string;
  purchaseNumber: string;
  purchaseDate: Date | string;
  grandTotal: number;
  supplierId?: string | null;
  isCashPurchase: boolean;
  inventoryAmount?: number; // Amount to add to inventory
  branchId?: string; // Branch ID for branch-wise accounting
  /** Same client as purchase INSERTs so ledger lines share one txn (deferred balance trigger). */
  poolClient?: PoolClient;
  // PHASE-3 GST split inputs (all optional, all default to 0 for back-compat)
  taxableValue?: number;       // = purchase.subtotal (post-discount, pre-tax)
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  itcEligible?: boolean;       // false → tax stays in Purchases (5101) per s.17(5)
  isReverseCharge?: boolean;   // true → also Cr RCM Output (2155); ITC still Dr Input
}): Promise<void> {
  const {
    businessId,
    purchaseId,
    purchaseNumber,
    purchaseDate,
    grandTotal,
    supplierId,
    isCashPurchase,
    inventoryAmount = 0,
    poolClient,
    taxableValue,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    itcEligible = true,
    isReverseCharge = false,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  if (!accounts.purchases) {
    throw new Error(
      `Purchases account (5101) not found for business ${businessId}. ` +
      `Cannot post purchase ${purchaseNumber}.`,
    );
  }

  // Fetch purchase items to check for discount accounts
  const purchaseItems = await ledgerQueryRows<{
    discount_amount: number;
    discount_account_id: string | null;
  }>(poolClient, `
    SELECT discount_amount, discount_account_id
    FROM purchase_items
    WHERE purchase_id = $1 AND discount_amount > 0 AND discount_account_id IS NOT NULL
  `, [purchaseId]);

  // Calculate total discount amount that needs to be posted to accounts
  let totalDiscountToAccount = 0;
  const discountAccountMap = new Map<string, number>(); // account_id -> total discount amount

  for (const item of purchaseItems) {
    if (item.discount_account_id && item.discount_amount > 0) {
      totalDiscountToAccount += Number(item.discount_amount);
      const current = discountAccountMap.get(item.discount_account_id) || 0;
      discountAccountMap.set(item.discount_account_id, current + Number(item.discount_amount));
    }
  }

  // ---- PHASE-3 split decision -----------------------------------------------
  // When a discount account is selected, the discount is posted as a separate
  // credit entry (Cr Discount Received). The Purchases debit must therefore use
  // the GROSS taxable value (before discount) so the voucher stays balanced:
  //
  //   1. ITC eligible regular purchase
  //        Dr Purchases  (taxable + account_discount)  ← gross before discount
  //        Dr Input CGST/SGST/IGST  (each tax)
  //        Cr AP/Cash    (grand_total)                 ← full supplier liability
  //        Cr Discount Received (account_discount)     ← Entry 5
  //   2. ITC ineligible (s.17(5) blocked credits — motor vehicles, food, etc)
  //        Dr Purchases  (grand_total + account_discount)  ← tax baked in, gross
  //        Cr AP/Cash    (grand_total)
  //        Cr Discount Received (account_discount)
  //   3. Reverse Charge (RCM)
  //        Dr Purchases  (taxable + account_discount)
  //        Dr Input CGST/SGST/IGST
  //        Cr AP/Cash    (taxable)                     ← supplier paid no tax
  //        Cr RCM Output (matching ITC amount)         ← we owe gov
  //        Cr Discount Received (account_discount)
  //
  // Falls back to legacy single-line behaviour if no GST passed OR split
  // accounts not provisioned yet (migration 166 hasn't run).
  // ---------------------------------------------------------------------------

  const totalGst = (cgstTotal || 0) + (sgstTotal || 0) + (igstTotal || 0) + (cessTotal || 0);
  const splitAccountsReady = !!(accounts.inputCgst && accounts.inputSgst && accounts.inputIgst);
  const useGstSplit = totalGst > 0 && splitAccountsReady && itcEligible;

  // Resolved net taxable (post-discount, pre-tax) from the grand total
  const derivedTaxable = totalGst > 0
    ? Math.max(0, Number((grandTotal - totalGst).toFixed(2)))
    : grandTotal;

  // Purchases debit = GROSS taxable (add discount back) so that the separate
  // Cr Discount Received entry (Entry 5) doesn't create an imbalance.
  const taxableForPurchasesDebit = useGstSplit
    ? Math.max(0, derivedTaxable + totalDiscountToAccount)
    : (grandTotal + totalDiscountToAccount); // legacy + ineligible: tax baked in

  // AP / Cash credit = full grand_total (the actual amount owed to supplier).
  // The discount is already accounted for via Cr Discount Received (Entry 5).
  //   - RCM purchase → credit = taxable only (tax leg balanced by Cr RCM Output).
  const rcmReady = isReverseCharge && useGstSplit && !!accounts.rcmOutput;
  const apCreditNet = rcmReady
    ? Math.max(0, derivedTaxable)
    : grandTotal;

  // Entry 1: Credit AP / Cash side (unchanged shape)
  if (isCashPurchase || !supplierId) {
    const cashAccount = accounts.cash || accounts.bank;
    if (!cashAccount) {
      throw new Error(
        `Cash/Bank account (1101/1102) not found for business ${businessId}. ` +
        `Cannot post cash purchase ${purchaseNumber}.`,
      );
    }

    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseId,
      voucherType: 'purchase',
      accountId: cashAccount.id,
      entryDate: purchaseDate,
      debit: 0,
      credit: apCreditNet,
      narration: `Cash purchase - ${purchaseNumber}`,
      referenceNumber: purchaseNumber,
      branchId: params.branchId,
      poolClient,
    });
  } else {
    if (!accounts.accountsPayable) {
      throw new Error(
        `Accounts Payable account (2101) not found for business ${businessId}. ` +
        `Cannot post credit purchase ${purchaseNumber}.`,
      );
    }

    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseId,
      voucherType: 'purchase',
      accountId: accounts.accountsPayable.id,
      entryDate: purchaseDate,
      debit: 0,
      credit: apCreditNet,
      narration: `Credit purchase - ${purchaseNumber}`,
      referenceNumber: purchaseNumber,
      branchId: params.branchId,
      poolClient,
    });
  }

  // Entry 2: Debit Purchases (taxable for ITC-eligible split, otherwise grand_total)
  await createLedgerEntryLine({
    businessId,
    voucherId: purchaseId,
    voucherType: 'purchase',
    accountId: accounts.purchases.id,
    entryDate: purchaseDate,
    debit: taxableForPurchasesDebit,
    credit: 0,
    narration: useGstSplit
      ? `Purchases (taxable) - ${purchaseNumber}`
      : (totalGst > 0 && !itcEligible
          ? `Purchases (incl. blocked ITC) - ${purchaseNumber}`
          : `Purchases - ${purchaseNumber}`),
    referenceNumber: purchaseNumber,
    branchId: params.branchId,
    poolClient,
  });

  // Entry 3 (PHASE-3): Debit Input GST accounts when split applies
  if (useGstSplit) {
    if (cgstTotal > 0 && accounts.inputCgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseId, voucherType: 'purchase',
        accountId: accounts.inputCgst.id, entryDate: purchaseDate,
        debit: cgstTotal, credit: 0,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input CGST - ${purchaseNumber}`,
        referenceNumber: purchaseNumber, branchId: params.branchId, poolClient,
      });
    }
    if (sgstTotal > 0 && accounts.inputSgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseId, voucherType: 'purchase',
        accountId: accounts.inputSgst.id, entryDate: purchaseDate,
        debit: sgstTotal, credit: 0,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input SGST - ${purchaseNumber}`,
        referenceNumber: purchaseNumber, branchId: params.branchId, poolClient,
      });
    }
    if (igstTotal > 0 && accounts.inputIgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseId, voucherType: 'purchase',
        accountId: accounts.inputIgst.id, entryDate: purchaseDate,
        debit: igstTotal, credit: 0,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input IGST - ${purchaseNumber}`,
        referenceNumber: purchaseNumber, branchId: params.branchId, poolClient,
      });
    }
    if (cessTotal > 0 && accounts.inputCess) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseId, voucherType: 'purchase',
        accountId: accounts.inputCess.id, entryDate: purchaseDate,
        debit: cessTotal, credit: 0,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input Cess - ${purchaseNumber}`,
        referenceNumber: purchaseNumber, branchId: params.branchId, poolClient,
      });
    }

    // Entry 4 (PHASE-3 RCM): Cr RCM Output for the tax amount.
    // Journal: Dr Purchases (taxable) + Dr Input GST (tax) = Cr AP (taxable) + Cr RCM Output (tax)
    if (rcmReady && accounts.rcmOutput) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseId, voucherType: 'purchase',
        accountId: accounts.rcmOutput.id, entryDate: purchaseDate,
        debit: 0, credit: totalGst,
        narration: `RCM Output Tax Payable - ${purchaseNumber}`,
        referenceNumber: purchaseNumber, branchId: params.branchId, poolClient,
      });
    }
  } else if (totalGst > 0 && !splitAccountsReady) {
    console.warn(
      `[PHASE-3 WARN] Purchase ${purchaseNumber} has GST=₹${totalGst.toFixed(2)} but business ${businessId} ` +
      `is missing Input GST split accounts (1110/1111/1112). Tax was rolled into Purchases — run migration 166.`,
    );
  }

  // Entry 5: Credit Discount Accounts (for each discount account)
  for (const [accountId, discountAmount] of discountAccountMap.entries()) {
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseId,
      voucherType: 'purchase',
      accountId: accountId,
      entryDate: purchaseDate,
      debit: 0,
      credit: discountAmount,
      narration: `Purchase discount - ${purchaseNumber}`,
      referenceNumber: purchaseNumber,
      branchId: params.branchId,
      poolClient,
    });
  }

  // Entry 6: Debit Inventory (if applicable). Inventory amount should already
  // be net of GST (caller passes the same value it INSERTs into items.stock).
  if (inventoryAmount > 0 && accounts.inventory) {
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseId,
      voucherType: 'purchase',
      accountId: accounts.inventory.id,
      entryDate: purchaseDate,
      debit: inventoryAmount,
      credit: 0,
      narration: `Inventory addition - ${purchaseNumber}`,
      referenceNumber: purchaseNumber,
      branchId: params.branchId,
      poolClient,
    });

    // Credit Purchases by the same amount (to move from Purchases to Inventory)
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseId,
      voucherType: 'purchase',
      accountId: accounts.purchases.id,
      entryDate: purchaseDate,
      debit: 0,
      credit: inventoryAmount,
      narration: `Transfer to inventory - ${purchaseNumber}`,
      referenceNumber: purchaseNumber,
      branchId: params.branchId,
      poolClient,
    });
  }
}

/**
 * Create double-entry ledger entries for an expense
 *
 * When cgst/sgst/igst amounts are provided (sum > 0), posts ITC split:
 *   Dr Expense (amount − total GST) + Dr Input CGST/SGST/IGST = Cr Cash/AP (amount).
 */
export async function createExpenseLedgerEntries(params: {
  businessId: string;
  expenseId: string;
  expenseDate: Date | string;
  amount: number;
  description?: string;
  paymentMode?: string;
  expenseAccountId?: string; // Optional: specific expense account
  branchId?: string; // Branch ID for branch-wise accounting
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  /** When set, both lines are posted in this transaction (no internal BEGIN/COMMIT). */
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    expenseId,
    expenseDate,
    amount,
    description,
    paymentMode,
    expenseAccountId,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    poolClient: outerClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  // Get expense account (use provided or default)
  const expenseAccount = expenseAccountId
    ? await db.queryOne<Account>(
        `SELECT * FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [expenseAccountId, businessId]
      )
    : accounts.expenses;

  if (!expenseAccount) {
    throw new Error(
      expenseAccountId
        ? `Expense ledger account not found or inactive (id: ${expenseAccountId}). Check the category mapping in Manage Categories.`
        : 'Default expense account is not set up for this business (expected 5201 / Administrative Expenses or mapping).'
    );
  }

  const expenseLedgerAcct: Account = expenseAccount;

  const onAccount = ['on_account', 'pay_later', 'unpaid', 'credit'].includes(
    String(paymentMode || '').toLowerCase()
  );

  // Paid from cash/bank, or bill received but not paid (credit Accounts Payable 2101)
  let secondLineAccount: Account;
  if (onAccount) {
    if (!accounts.accountsPayable) {
      throw new Error(
        'Accounts Payable (2101) is not set up for this business. ' +
          'Add it in chart of accounts or run default account setup, then use “On account (unpaid)”.',
      );
    }
    secondLineAccount = accounts.accountsPayable;
  } else {
    const paymentAccount = await getAccountForPaymentMode(businessId, paymentMode || 'cash');
    if (!paymentAccount) {
      throw new Error(
        `No Cash/Bank ledger account found for payment mode "${paymentMode || 'cash'}". ` +
          `Ensure accounts 1101 (Cash) or 1102 (Bank) exist, or configure payment mode mappings.`
      );
    }
    secondLineAccount = paymentAccount;
  }

  const lineCommon = {
    businessId,
    voucherId: expenseId,
    voucherType: 'expense' as const,
    entryDate: expenseDate,
    referenceNumber: expenseId.substring(0, 8),
    branchId: params.branchId,
  };

  const cgst = Number(cgstTotal) || 0;
  const sgst = Number(sgstTotal) || 0;
  const igst = Number(igstTotal) || 0;
  const cess = Number(cessTotal) || 0;
  const totalGst = cgst + sgst + igst + cess;
  const expenseBase = Math.max(0, Number((amount - totalGst).toFixed(2)));

  const useGstSplit =
    totalGst > 0.005 &&
    !!(accounts.inputCgst && accounts.inputSgst && accounts.inputIgst);

  if (totalGst > 0.005 && !useGstSplit) {
    throw new Error(
      `This expense includes GST (₹${totalGst.toFixed(2)}) but Input GST accounts (1110/1111/1112) are not set up. ` +
        `Run migration 166 / chart-of-accounts seed for this business, or clear the GST fields.`,
    );
  }

  if (totalGst > 0.005) {
    const sumCheck = Number((expenseBase + totalGst).toFixed(2));
    const amt = Number(Number(amount).toFixed(2));
    if (Math.abs(sumCheck - amt) > 0.02) {
      throw new Error(
        `Expense total (₹${amt}) must equal taxable expense + GST (₹${expenseBase} + ₹${totalGst.toFixed(2)} = ₹${sumCheck}).`,
      );
    }
  }

  async function postLines(poolClient: PoolClient | undefined) {
    if (!useGstSplit) {
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: expenseLedgerAcct.id,
        debit: amount,
        credit: 0,
        narration: description || 'Expense',
        poolClient,
      });
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: secondLineAccount.id,
        debit: 0,
        credit: amount,
        narration: onAccount
          ? `Payable (unpaid) — ${description || 'Expense'}`
          : `Payment for expense: ${description || 'Expense'}`,
        poolClient,
      });
      return;
    }

    await createLedgerEntryLine({
      ...lineCommon,
      accountId: expenseLedgerAcct.id,
      debit: expenseBase,
      credit: 0,
      narration: (description || 'Expense') + ' (taxable)',
      poolClient,
    });
    if (cgst > 0 && accounts.inputCgst) {
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: accounts.inputCgst.id,
        debit: cgst,
        credit: 0,
        narration: `Input CGST — ${description || 'Expense'}`,
        poolClient,
      });
    }
    if (sgst > 0 && accounts.inputSgst) {
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: accounts.inputSgst.id,
        debit: sgst,
        credit: 0,
        narration: `Input SGST — ${description || 'Expense'}`,
        poolClient,
      });
    }
    if (igst > 0 && accounts.inputIgst) {
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: accounts.inputIgst.id,
        debit: igst,
        credit: 0,
        narration: `Input IGST — ${description || 'Expense'}`,
        poolClient,
      });
    }
    if (cess > 0 && accounts.inputCess) {
      await createLedgerEntryLine({
        ...lineCommon,
        accountId: accounts.inputCess.id,
        debit: cess,
        credit: 0,
        narration: `Input Cess — ${description || 'Expense'}`,
        poolClient,
      });
    }
    await createLedgerEntryLine({
      ...lineCommon,
      accountId: secondLineAccount.id,
      debit: 0,
      credit: amount,
      narration: onAccount
        ? `Payable (unpaid) — ${description || 'Expense'}`
        : `Payment for expense: ${description || 'Expense'}`,
      poolClient,
    });
  }

  if (outerClient) {
    await postLines(outerClient);
    return;
  }

  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    await postLines(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Create double-entry ledger entries for a credit note (sales return).
 *
 * PHASE-3 GST split: Sales is DEBITED only the taxable portion; CGST/SGST/IGST/Cess
 * are DEBITED to the corresponding Output GST liability accounts (which reverses
 * the original credit posted by the source invoice). AR is credited grand_total.
 * Falls back to the legacy single-line behaviour if no GST is passed or split
 * accounts haven't been provisioned.
 */
export async function createCreditNoteLedgerEntries(params: {
  businessId: string;
  creditNoteId: string;
  creditNoteNumber: string;
  creditNoteDate: Date | string;
  grandTotal: number;
  customerId: string;
  cogsAmount?: number; // Cost of Goods Sold amount (if inventory tracking)
  branchId?: string; // Branch ID for branch-wise accounting
  // PHASE-3
  taxableValue?: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  // PHASE-5: shared transaction client (see createInvoiceLedgerEntries for why).
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    creditNoteId,
    creditNoteNumber,
    creditNoteDate,
    grandTotal,
    cogsAmount = 0,
    taxableValue,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    poolClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  if (!accounts.sales) {
    throw new Error(
      `Sales account (4101) not found for business ${businessId}. ` +
      `Cannot post credit note ${creditNoteNumber}.`,
    );
  }

  if (!accounts.accountsReceivable) {
    throw new Error(
      `Accounts Receivable account (1103) not found for business ${businessId}. ` +
      `Cannot post credit note ${creditNoteNumber}.`,
    );
  }

  const totalGst = (cgstTotal || 0) + (sgstTotal || 0) + (igstTotal || 0) + (cessTotal || 0);
  const splitAccountsReady = !!(accounts.outputCgst && accounts.outputSgst && accounts.outputIgst);
  const useGstSplit = totalGst > 0 && splitAccountsReady;
  const derivedTaxable = totalGst > 0
    ? Math.max(0, Number((grandTotal - totalGst).toFixed(2)))
    : grandTotal;
  const salesDebit = useGstSplit
    ? derivedTaxable
    : (taxableValue && taxableValue > 0 && totalGst === 0 ? taxableValue : grandTotal);

  // Entry 1: Debit Sales (taxable portion in split mode, full grand_total in legacy)
  await createLedgerEntryLine({
    businessId,
    voucherId: creditNoteId,
    voucherType: 'credit_note',
    accountId: accounts.sales.id,
    entryDate: creditNoteDate,
    debit: salesDebit,
    credit: 0,
    narration: useGstSplit
      ? `Sales return (taxable) - Credit Note ${creditNoteNumber}`
      : `Sales return - Credit Note ${creditNoteNumber}`,
    referenceNumber: creditNoteNumber,
    branchId: params.branchId,
    poolClient,
  });

  // Entry 1b (PHASE-3): Debit Output GST accounts to reverse the original credit
  if (useGstSplit) {
    if (cgstTotal > 0 && accounts.outputCgst) {
      await createLedgerEntryLine({
        businessId, voucherId: creditNoteId, voucherType: 'credit_note',
        accountId: accounts.outputCgst.id, entryDate: creditNoteDate,
        debit: cgstTotal, credit: 0,
        narration: `Output CGST reversal - Credit Note ${creditNoteNumber}`,
        referenceNumber: creditNoteNumber, branchId: params.branchId, poolClient,
      });
    }
    if (sgstTotal > 0 && accounts.outputSgst) {
      await createLedgerEntryLine({
        businessId, voucherId: creditNoteId, voucherType: 'credit_note',
        accountId: accounts.outputSgst.id, entryDate: creditNoteDate,
        debit: sgstTotal, credit: 0,
        narration: `Output SGST reversal - Credit Note ${creditNoteNumber}`,
        referenceNumber: creditNoteNumber, branchId: params.branchId, poolClient,
      });
    }
    if (igstTotal > 0 && accounts.outputIgst) {
      await createLedgerEntryLine({
        businessId, voucherId: creditNoteId, voucherType: 'credit_note',
        accountId: accounts.outputIgst.id, entryDate: creditNoteDate,
        debit: igstTotal, credit: 0,
        narration: `Output IGST reversal - Credit Note ${creditNoteNumber}`,
        referenceNumber: creditNoteNumber, branchId: params.branchId, poolClient,
      });
    }
    if (cessTotal > 0 && accounts.outputCess) {
      await createLedgerEntryLine({
        businessId, voucherId: creditNoteId, voucherType: 'credit_note',
        accountId: accounts.outputCess.id, entryDate: creditNoteDate,
        debit: cessTotal, credit: 0,
        narration: `Output Cess reversal - Credit Note ${creditNoteNumber}`,
        referenceNumber: creditNoteNumber, branchId: params.branchId, poolClient,
      });
    }
  } else if (totalGst > 0 && !splitAccountsReady) {
    console.warn(
      `[PHASE-3 WARN] Credit Note ${creditNoteNumber} has GST=₹${totalGst.toFixed(2)} but split accounts missing — Sales debited the full grand_total.`,
    );
  }

  // Entry 2: Credit Accounts Receivable (reduce customer receivable) — always grand_total
  await createLedgerEntryLine({
    businessId,
    voucherId: creditNoteId,
    voucherType: 'credit_note',
    accountId: accounts.accountsReceivable.id,
    entryDate: creditNoteDate,
    debit: 0,
    credit: grandTotal,
    narration: `Credit Note ${creditNoteNumber} - Reduce receivables`,
    referenceNumber: creditNoteNumber,
    branchId: params.branchId,
    poolClient,
  });

  // PHASE-4: per-credit-note COGS reversal is DISABLED for periodic-inventory books.
  // (Same rationale as createInvoiceLedgerEntries above.) Periodic books reverse
  // COGS implicitly at period end through the Closing Stock revaluation.
  if (cogsAmount > 0) {
    console.warn(
      `[PHASE-4] cogsAmount=₹${cogsAmount.toFixed(2)} ignored for credit note ${creditNoteNumber} ` +
      `— inventory_model is periodic; COGS reversal happens at period end via Closing Stock.`,
    );
  }
}

/**
 * Create double-entry ledger entries for a purchase return.
 *
 * PHASE-3 GST split: Purchases is CREDITED only the taxable portion; CGST/SGST/IGST
 * are CREDITED to the corresponding Input GST asset accounts (reversing the original
 * ITC debit). AP/Cash debit is grand_total (or taxable in RCM, mirroring the
 * source purchase). itcEligible=false bakes the tax back into Purchases.
 */
export async function createPurchaseReturnLedgerEntries(params: {
  businessId: string;
  purchaseReturnId: string;
  returnNumber: string;
  returnDate: Date | string;
  grandTotal: number;
  supplierId?: string | null;
  inventoryAmount?: number; // Amount to reduce from inventory
  branchId?: string; // Branch ID for branch-wise accounting
  // PHASE-3
  taxableValue?: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  itcEligible?: boolean;
  isReverseCharge?: boolean;
  // PHASE-5: shared transaction client.
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    purchaseReturnId,
    returnNumber,
    returnDate,
    grandTotal,
    supplierId,
    inventoryAmount = 0,
    taxableValue,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    itcEligible = true,
    isReverseCharge = false,
    poolClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  if (!accounts.purchases) {
    throw new Error(
      `Purchases account (5101) not found for business ${businessId}. ` +
      `Cannot post purchase return ${returnNumber}.`,
    );
  }

  const totalGst = (cgstTotal || 0) + (sgstTotal || 0) + (igstTotal || 0) + (cessTotal || 0);
  const splitAccountsReady = !!(accounts.inputCgst && accounts.inputSgst && accounts.inputIgst);
  const useGstSplit = totalGst > 0 && splitAccountsReady && itcEligible;
  const rcmReady = isReverseCharge && useGstSplit && !!accounts.rcmOutput;
  const derivedTaxable = totalGst > 0
    ? Math.max(0, Number((grandTotal - totalGst).toFixed(2)))
    : grandTotal;
  const purchasesCredit = useGstSplit
    ? derivedTaxable
    : (taxableValue && taxableValue > 0 && totalGst === 0 ? taxableValue : grandTotal);
  // Mirror the source-purchase AP behaviour: RCM AP debit = taxable; otherwise grand_total.
  const apDebit = rcmReady ? derivedTaxable : grandTotal;

  // Entry 1: Credit Purchases Account (reversal — reduce purchases for taxable only)
  await createLedgerEntryLine({
    businessId,
    voucherId: purchaseReturnId,
    voucherType: 'purchase_return',
    accountId: accounts.purchases.id,
    entryDate: returnDate,
    debit: 0,
    credit: purchasesCredit,
    narration: useGstSplit
      ? `Purchase return (taxable) - ${returnNumber}`
      : `Purchase return - ${returnNumber}`,
    referenceNumber: returnNumber,
    branchId: params.branchId,
    poolClient,
  });

  // Entry 1b (PHASE-3): Credit Input GST accounts to reverse the original ITC debit
  if (useGstSplit) {
    if (cgstTotal > 0 && accounts.inputCgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseReturnId, voucherType: 'purchase_return',
        accountId: accounts.inputCgst.id, entryDate: returnDate,
        debit: 0, credit: cgstTotal,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input CGST reversal - ${returnNumber}`,
        referenceNumber: returnNumber, branchId: params.branchId, poolClient,
      });
    }
    if (sgstTotal > 0 && accounts.inputSgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseReturnId, voucherType: 'purchase_return',
        accountId: accounts.inputSgst.id, entryDate: returnDate,
        debit: 0, credit: sgstTotal,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input SGST reversal - ${returnNumber}`,
        referenceNumber: returnNumber, branchId: params.branchId, poolClient,
      });
    }
    if (igstTotal > 0 && accounts.inputIgst) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseReturnId, voucherType: 'purchase_return',
        accountId: accounts.inputIgst.id, entryDate: returnDate,
        debit: 0, credit: igstTotal,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input IGST reversal - ${returnNumber}`,
        referenceNumber: returnNumber, branchId: params.branchId, poolClient,
      });
    }
    if (cessTotal > 0 && accounts.inputCess) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseReturnId, voucherType: 'purchase_return',
        accountId: accounts.inputCess.id, entryDate: returnDate,
        debit: 0, credit: cessTotal,
        narration: `${isReverseCharge ? 'RCM ' : ''}Input Cess reversal - ${returnNumber}`,
        referenceNumber: returnNumber, branchId: params.branchId, poolClient,
      });
    }

    // RCM source had Cr RCM Output for the tax — so the return must Dr RCM Output to undo it.
    if (rcmReady && accounts.rcmOutput) {
      await createLedgerEntryLine({
        businessId, voucherId: purchaseReturnId, voucherType: 'purchase_return',
        accountId: accounts.rcmOutput.id, entryDate: returnDate,
        debit: totalGst, credit: 0,
        narration: `RCM Output Tax reversal - ${returnNumber}`,
        referenceNumber: returnNumber, branchId: params.branchId, poolClient,
      });
    }
  } else if (totalGst > 0 && !splitAccountsReady) {
    console.warn(
      `[PHASE-3 WARN] Purchase return ${returnNumber} has GST=₹${totalGst.toFixed(2)} but split accounts missing — Purchases credited the full grand_total.`,
    );
  }

  // Entry 2: Debit Accounts Payable / Cash. apDebit = taxable for RCM, grand_total otherwise.
  if (supplierId && accounts.accountsPayable) {
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseReturnId,
      voucherType: 'purchase_return',
      accountId: accounts.accountsPayable.id,
      entryDate: returnDate,
      debit: apDebit,
      credit: 0,
      narration: `Purchase return ${returnNumber} - Reduce payables`,
      referenceNumber: returnNumber,
      branchId: params.branchId,
      poolClient,
    });
  } else {
    const cashAccount = accounts.cash || accounts.bank;
    if (!cashAccount) {
      throw new Error(
        `Cash/Bank account (1101/1102) not found for business ${businessId}. ` +
        `Cannot post cash purchase return ${returnNumber}.`,
      );
    }
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseReturnId,
      voucherType: 'purchase_return',
      accountId: cashAccount.id,
      entryDate: returnDate,
      debit: apDebit,
      credit: 0,
      narration: `Purchase return ${returnNumber} - Cash refund`,
      referenceNumber: returnNumber,
      branchId: params.branchId,
      poolClient,
    });
  }

  // Entry 3: Credit Inventory (goods going back to supplier)
  if (inventoryAmount > 0 && accounts.inventory) {
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseReturnId,
      voucherType: 'purchase_return',
      accountId: accounts.inventory.id,
      entryDate: returnDate,
      debit: 0,
      credit: inventoryAmount,
      narration: `Inventory reduction - Purchase return ${returnNumber}`,
      referenceNumber: returnNumber,
      branchId: params.branchId,
      poolClient,
    });

    // Entry 4: Debit Purchases by the same amount (to reverse the inventory transfer)
    await createLedgerEntryLine({
      businessId,
      voucherId: purchaseReturnId,
      voucherType: 'purchase_return',
      accountId: accounts.purchases.id,
      entryDate: returnDate,
      debit: inventoryAmount,
      credit: 0,
      narration: `Reverse inventory transfer - Purchase return ${returnNumber}`,
      referenceNumber: returnNumber,
      branchId: params.branchId,
      poolClient,
    });
  }
}

/**
 * Create double-entry ledger entries for a payment
 */
export async function createPaymentLedgerEntries(params: {
  businessId: string;
  paymentId: string;
  paymentDate: Date | string;
  amount: number;
  type: 'receivable' | 'payable';
  customerId?: string | null;
  supplierId?: string | null;
  paymentMode?: string;
  referenceNumber?: string;
  description?: string;
  branchId?: string; // Branch ID for branch-wise accounting
  // PHASE-5: shared transaction client.
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    paymentId,
    paymentDate,
    amount,
    type,
    customerId,
    supplierId,
    paymentMode,
    referenceNumber,
    description,
    poolClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  // Get payment account (Cash or Bank)
  const paymentAccount = await getAccountForPaymentMode(businessId, paymentMode || 'cash');
  if (!paymentAccount) {
    throw new Error(
      `Payment account (Cash/Bank for mode '${paymentMode || 'cash'}') not found for business ${businessId}. ` +
      `Cannot post payment ${paymentId}.`,
    );
  }

  if (type === 'receivable' && customerId) {
    // Payment received from customer
    // Debit Cash/Bank, Credit Accounts Receivable
    if (!accounts.accountsReceivable) {
      throw new Error(
        `Accounts Receivable account (1103) not found for business ${businessId}. ` +
        `Cannot post receipt ${paymentId}.`,
      );
    }

    // Debit Cash/Bank
    await createLedgerEntryLine({
      businessId,
      voucherId: paymentId,
      voucherType: 'payment',
      accountId: paymentAccount.id,
      entryDate: paymentDate,
      debit: amount,
      credit: 0,
      narration: description || `Payment received${referenceNumber ? ` - ${referenceNumber}` : ''}`,
      referenceNumber: referenceNumber || paymentId.substring(0, 8),
      branchId: params.branchId,
      poolClient,
    });

    // Credit Accounts Receivable
    await createLedgerEntryLine({
      businessId,
      voucherId: paymentId,
      voucherType: 'payment',
      accountId: accounts.accountsReceivable.id,
      entryDate: paymentDate,
      debit: 0,
      credit: amount,
      narration: description || `Payment received from customer${referenceNumber ? ` - ${referenceNumber}` : ''}`,
      referenceNumber: referenceNumber || paymentId.substring(0, 8),
      branchId: params.branchId,
      poolClient,
    });
  } else if (type === 'payable' && supplierId) {
    // Payment made to supplier
    // Debit Accounts Payable, Credit Cash/Bank
    if (!accounts.accountsPayable) {
      throw new Error(
        `Accounts Payable account (2101) not found for business ${businessId}. ` +
        `Cannot post payment ${paymentId}.`,
      );
    }

    // Debit Accounts Payable
    await createLedgerEntryLine({
      businessId,
      voucherId: paymentId,
      voucherType: 'payment',
      accountId: accounts.accountsPayable.id,
      entryDate: paymentDate,
      debit: amount,
      credit: 0,
      narration: description || `Payment made${referenceNumber ? ` - ${referenceNumber}` : ''}`,
      referenceNumber: referenceNumber || paymentId.substring(0, 8),
      branchId: params.branchId,
      poolClient,
    });

    // Credit Cash/Bank
    await createLedgerEntryLine({
      businessId,
      voucherId: paymentId,
      voucherType: 'payment',
      accountId: paymentAccount.id,
      entryDate: paymentDate,
      debit: 0,
      credit: amount,
      narration: description || `Payment made to supplier${referenceNumber ? ` - ${referenceNumber}` : ''}`,
      referenceNumber: referenceNumber || paymentId.substring(0, 8),
      branchId: params.branchId,
      poolClient,
    });
  }
}

/**
 * Create double-entry ledger entries for a debit note (additional charge to customer).
 *
 * PHASE-3 GST split: mirrors createInvoiceLedgerEntries — Sales is credited only the
 * taxable portion; Output CGST/SGST/IGST are credited separately so GSTR-1 / books align.
 */
export async function createDebitNoteLedgerEntries(params: {
  businessId: string;
  debitNoteId: string;
  debitNoteNumber: string;
  debitNoteDate: Date | string;
  grandTotal: number;
  customerId: string;
  branchId?: string; // Branch ID for branch-wise accounting
  cogsAmount?: number; // Cost of Goods Sold amount (if inventory tracking)
  /** Taxable value (ex-GST) when known; improves split when header GST is zero. */
  taxableValue?: number;
  cgstTotal?: number;
  sgstTotal?: number;
  igstTotal?: number;
  cessTotal?: number;
  // PHASE-5: shared transaction client.
  poolClient?: PoolClient;
}): Promise<void> {
  const {
    businessId,
    debitNoteId,
    debitNoteNumber,
    debitNoteDate,
    grandTotal,
    customerId,
    branchId,
    cogsAmount = 0,
    taxableValue,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0,
    cessTotal = 0,
    poolClient,
  } = params;

  const accounts = await getDefaultAccounts(businessId);

  if (!accounts.sales) {
    throw new Error(
      `Sales account (4101) not found for business ${businessId}. ` +
      `Cannot post debit note ${debitNoteNumber}.`,
    );
  }

  if (!accounts.accountsReceivable) {
    throw new Error(
      `Accounts Receivable account (1103) not found for business ${businessId}. ` +
      `Cannot post debit note ${debitNoteNumber}.`,
    );
  }

  const totalGst =
    (cgstTotal || 0) + (sgstTotal || 0) + (igstTotal || 0) + (cessTotal || 0);
  const derivedTaxable = Math.max(0, Number((grandTotal - totalGst).toFixed(2)));
  const salesCredit =
    totalGst > 0
      ? derivedTaxable
      : taxableValue && taxableValue > 0
        ? taxableValue
        : grandTotal;

  const splitAccountsReady = !!(
    accounts.outputCgst &&
    accounts.outputSgst &&
    accounts.outputIgst
  );
  const useGstSplit = totalGst > 0 && splitAccountsReady;

  // Entry 1: Debit Accounts Receivable (increase customer receivable)
  await createLedgerEntryLine({
    businessId,
    voucherId: debitNoteId,
    voucherType: 'debit_note',
    accountId: accounts.accountsReceivable.id,
    entryDate: debitNoteDate,
    debit: grandTotal,
    credit: 0,
    narration: `Debit Note ${debitNoteNumber} - Additional charge`,
    referenceNumber: debitNoteNumber,
    branchId,
    poolClient,
  });

  // Entry 2: Credit Sales (taxable only when GST split applies)
  await createLedgerEntryLine({
    businessId,
    voucherId: debitNoteId,
    voucherType: 'debit_note',
    accountId: accounts.sales.id,
    entryDate: debitNoteDate,
    debit: 0,
    credit: useGstSplit ? salesCredit : grandTotal,
    narration: useGstSplit
      ? `Sales (taxable) - Debit Note ${debitNoteNumber}`
      : `Sales - Debit Note ${debitNoteNumber}`,
    referenceNumber: debitNoteNumber,
    branchId,
    poolClient,
  });

  // Entry 3 (PHASE-3): Credit Output GST (same shape as invoice)
  if (useGstSplit) {
    if (cgstTotal > 0 && accounts.outputCgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: debitNoteId,
        voucherType: 'debit_note',
        accountId: accounts.outputCgst.id,
        entryDate: debitNoteDate,
        debit: 0,
        credit: cgstTotal,
        narration: `Output CGST - Debit Note ${debitNoteNumber}`,
        referenceNumber: debitNoteNumber,
        branchId,
        poolClient,
      });
    }
    if (sgstTotal > 0 && accounts.outputSgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: debitNoteId,
        voucherType: 'debit_note',
        accountId: accounts.outputSgst.id,
        entryDate: debitNoteDate,
        debit: 0,
        credit: sgstTotal,
        narration: `Output SGST - Debit Note ${debitNoteNumber}`,
        referenceNumber: debitNoteNumber,
        branchId,
        poolClient,
      });
    }
    if (igstTotal > 0 && accounts.outputIgst) {
      await createLedgerEntryLine({
        businessId,
        voucherId: debitNoteId,
        voucherType: 'debit_note',
        accountId: accounts.outputIgst.id,
        entryDate: debitNoteDate,
        debit: 0,
        credit: igstTotal,
        narration: `Output IGST - Debit Note ${debitNoteNumber}`,
        referenceNumber: debitNoteNumber,
        branchId,
        poolClient,
      });
    }
    if (cessTotal > 0 && accounts.outputCess) {
      await createLedgerEntryLine({
        businessId,
        voucherId: debitNoteId,
        voucherType: 'debit_note',
        accountId: accounts.outputCess.id,
        entryDate: debitNoteDate,
        debit: 0,
        credit: cessTotal,
        narration: `Output Cess - Debit Note ${debitNoteNumber}`,
        referenceNumber: debitNoteNumber,
        branchId,
        poolClient,
      });
    }
  } else if (totalGst > 0 && !splitAccountsReady) {
    console.warn(
      `[PHASE-3 WARN] Debit Note ${debitNoteNumber} has GST=₹${totalGst.toFixed(2)} but business ${businessId} ` +
        `is missing Output GST split accounts (2150/2151/2152). Sales was credited the full grand_total — run migration 166.`,
    );
  }

  // PHASE-4: per-debit-note COGS posting is DISABLED for periodic-inventory books.
  // (Same rationale as createInvoiceLedgerEntries.) Periodic books absorb the
  // additional cost into Closing Stock at period end.
  if (cogsAmount > 0) {
    console.warn(
      `[PHASE-4] cogsAmount=₹${cogsAmount.toFixed(2)} ignored for debit note ${debitNoteNumber} ` +
      `— inventory_model is periodic; COGS is computed at period end, not per debit note.`,
    );
  }
}

