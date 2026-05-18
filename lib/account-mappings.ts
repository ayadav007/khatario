/**
 * Account Mappings Utility
 * Manages configurable account mappings for transactions
 */

import * as db from '@/lib/db';
import { Account } from '@/types/database';

export interface AccountMappings {
  sales_account_id?: string;
  accounts_receivable_account_id?: string;
  cash_account_id?: string;
  bank_account_id?: string;
  purchases_account_id?: string;
  accounts_payable_account_id?: string;
  inventory_account_id?: string;
  cogs_account_id?: string;
  expense_account_id?: string;
  payment_modes?: {
    cash?: string;
    bank?: string;
    upi?: string;
    credit_card?: string;
    [key: string]: string | undefined;
  };
}

/**
 * Get account mappings for a business
 */
export async function getAccountMappings(businessId: string): Promise<AccountMappings> {
  try {
    const settings = await db.queryOne<{ account_mappings?: AccountMappings }>(
      `SELECT account_mappings FROM business_settings WHERE business_id = $1`,
      [businessId]
    );

    return settings?.account_mappings || {};
  } catch (error) {
    console.error('Error fetching account mappings:', error);
    return {};
  }
}

/**
 * Update account mappings for a business
 */
export async function updateAccountMappings(
  businessId: string,
  mappings: Partial<AccountMappings>
): Promise<void> {
  try {
    const existing = await getAccountMappings(businessId);
    const updated = { ...existing, ...mappings };

    await db.query(
      `UPDATE business_settings 
       SET account_mappings = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE business_id = $2`,
      [JSON.stringify(updated), businessId]
    );
  } catch (error) {
    console.error('Error updating account mappings:', error);
    throw error;
  }
}

/**
 * Get mapped account ID or fallback to default
 */
export async function getMappedAccountId(
  businessId: string,
  mappingKey: keyof AccountMappings,
  fallbackAccountCode?: string,
  fallbackAccountName?: string
): Promise<string | null> {
  try {
    const mappings = await getAccountMappings(businessId);
    const accountId = mappings[mappingKey] as string | undefined;

    if (accountId) {
      // Verify account exists and is active
      const account = await db.queryOne<Account>(
        `SELECT id FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [accountId, businessId]
      );

      if (account) {
        return accountId;
      }
    }

    // Fallback to default account lookup
    if (fallbackAccountCode) {
      const account = await db.queryOne<Account>(
        `SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2 AND is_active = true`,
        [businessId, fallbackAccountCode]
      );
      if (account) return account.id;
    }

    if (fallbackAccountName) {
      const account = await db.queryOne<Account>(
        `SELECT id FROM accounts WHERE business_id = $1 AND LOWER(account_name) = LOWER($2) AND is_active = true LIMIT 1`,
        [businessId, fallbackAccountName]
      );
      if (account) return account.id;
    }

    return null;
  } catch (error) {
    console.error(`Error getting mapped account for ${mappingKey}:`, error);
    return null;
  }
}

/**
 * Get payment mode account ID
 */
export async function getPaymentModeAccountId(
  businessId: string,
  paymentMode: string
): Promise<string | null> {
  try {
    const mappings = await getAccountMappings(businessId);
    const mode = paymentMode?.toLowerCase() || 'cash';

    // Check configured payment mode mapping
    if (mappings.payment_modes?.[mode]) {
      const accountId = mappings.payment_modes[mode];
      if (accountId) {
        const account = await db.queryOne<Account>(
          `SELECT id FROM accounts WHERE id = $1 AND business_id = $2 AND is_active = true`,
          [accountId, businessId]
        );
        if (account) return accountId;
      }
    }

    // Fallback to default mappings
    if (mode === 'cash') {
      return await getMappedAccountId(businessId, 'cash_account_id', '1101', 'Cash');
    }

    if (mode === 'bank' || mode === 'bank_transfer' || mode === 'neft' || mode === 'rtgs') {
      return await getMappedAccountId(businessId, 'bank_account_id', '1102', 'Bank Account');
    }

    // Default to cash for other modes
    return await getMappedAccountId(businessId, 'cash_account_id', '1101', 'Cash');
  } catch (error) {
    console.error('Error getting payment mode account:', error);
    return null;
  }
}

/**
 * Auto-detect and save account mappings from existing accounts
 */
export async function autoDetectAccountMappings(businessId: string): Promise<AccountMappings> {
  try {
    const accounts = await db.queryRows<Account>(
      `SELECT * FROM accounts WHERE business_id = $1 AND is_active = true`,
      [businessId]
    );

    const mappings: AccountMappings = {};

    // Find accounts by code or name
    const salesAccount = accounts.find(a => a.account_code === '4101' || a.account_name.toLowerCase() === 'sales');
    if (salesAccount) mappings.sales_account_id = salesAccount.id;

    const receivablesAccount = accounts.find(a => a.account_code === '1103' || a.account_name.toLowerCase().includes('receivable'));
    if (receivablesAccount) mappings.accounts_receivable_account_id = receivablesAccount.id;

    const cashAccount = accounts.find(a => a.account_code === '1101' || a.account_name.toLowerCase() === 'cash');
    if (cashAccount) mappings.cash_account_id = cashAccount.id;

    const bankAccount = accounts.find(a => a.account_code === '1102' || a.account_name.toLowerCase().includes('bank'));
    if (bankAccount) mappings.bank_account_id = bankAccount.id;

    const purchasesAccount = accounts.find(a => a.account_code === '5101' || a.account_name.toLowerCase() === 'purchases');
    if (purchasesAccount) mappings.purchases_account_id = purchasesAccount.id;

    const payablesAccount = accounts.find(a => a.account_code === '2101' || a.account_name.toLowerCase().includes('payable'));
    if (payablesAccount) mappings.accounts_payable_account_id = payablesAccount.id;

    const inventoryAccount = accounts.find(a => a.account_code === '1104' || a.account_name.toLowerCase() === 'inventory');
    if (inventoryAccount) mappings.inventory_account_id = inventoryAccount.id;

    const cogsAccount = accounts.find(a => a.account_code === '5101' || a.account_name.toLowerCase().includes('cogs') || a.account_name.toLowerCase().includes('cost of goods'));
    if (cogsAccount) mappings.cogs_account_id = cogsAccount.id;

    const expenseAccount = accounts.find(a => a.account_code === '5201' || a.account_name.toLowerCase().includes('administrative expense'));
    if (expenseAccount) mappings.expense_account_id = expenseAccount.id;

    // Save mappings
    await updateAccountMappings(businessId, mappings);

    return mappings;
  } catch (error) {
    console.error('Error auto-detecting account mappings:', error);
    return {};
  }
}

