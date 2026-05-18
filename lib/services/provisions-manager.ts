/**
 * Provisions Manager Service
 * Manages provisions (bad debts, warranty, employee benefits, etc.)
 */

import { queryRows, queryOne, getPool } from '@/lib/db';

export type ProvisionType =
  | 'bad_debts'
  | 'warranty'
  | 'gratuity'
  | 'leave_encashment'
  | 'employee_benefits'
  | 'litigation'
  | 'others';

export type ProvisionEntryType = 'addition' | 'reversal' | 'utilization';

export interface Provision {
  id: string;
  business_id: string;
  provision_code: string;
  provision_name: string;
  provision_type: ProvisionType;
  provision_account_id: string;
  expense_account_id: string;
  calculation_method?: string;
  calculation_rate?: number;
  description?: string;
  is_active: boolean;
}

export interface ProvisionEntry {
  id: string;
  provision_id: string;
  financial_year: string;
  entry_date: string;
  entry_type: ProvisionEntryType;
  amount: number;
  opening_balance: number;
  closing_balance: number;
  reference_type?: string;
  reference_id?: string;
  narration?: string;
  is_posted: boolean;
}

/**
 * Create a new provision
 */
export async function createProvision(
  businessId: string,
  provision: Omit<Provision, 'id' | 'business_id'>
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const result = await client.query(
      `INSERT INTO provisions (
        business_id,
        provision_code,
        provision_name,
        provision_type,
        provision_account_id,
        expense_account_id,
        calculation_method,
        calculation_rate,
        description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        businessId,
        provision.provision_code,
        provision.provision_name,
        provision.provision_type,
        provision.provision_account_id,
        provision.expense_account_id,
        provision.calculation_method || null,
        provision.calculation_rate || null,
        provision.description || null,
      ]
    );

    return result.rows[0].id;
  } finally {
    client.release();
  }
}

/**
 * Get all provisions for a business
 */
export async function getProvisions(businessId: string): Promise<Provision[]> {
  const provisions = await queryRows<Provision>(
    `SELECT * FROM provisions
     WHERE business_id = $1 AND is_active = true
     ORDER BY provision_code`,
    [businessId]
  );

  return provisions;
}

/**
 * Get provision by ID
 */
export async function getProvisionById(
  provisionId: string,
  businessId: string
): Promise<Provision | null> {
  const provision = await queryOne<Provision>(
    `SELECT * FROM provisions
     WHERE id = $1 AND business_id = $2`,
    [provisionId, businessId]
  );

  return provision || null;
}

/**
 * Create a provision entry (addition, reversal, or utilization)
 */
export async function createProvisionEntry(
  businessId: string,
  provisionId: string,
  financialYear: string,
  entryDate: string,
  entryType: ProvisionEntryType,
  amount: number,
  referenceType?: string,
  referenceId?: string,
  narration?: string
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current balance for the provision
    const currentBalance = await getProvisionBalance(
      client,
      provisionId,
      financialYear,
      entryDate
    );

    // Calculate opening and closing balance
    let openingBalance = currentBalance;
    let closingBalance = currentBalance;

    if (entryType === 'addition') {
      closingBalance = currentBalance + amount;
    } else if (entryType === 'reversal') {
      closingBalance = Math.max(0, currentBalance - amount);
    } else if (entryType === 'utilization') {
      closingBalance = Math.max(0, currentBalance - amount);
    }

    // Insert provision entry
    const result = await client.query(
      `INSERT INTO provision_entries (
        business_id,
        provision_id,
        financial_year,
        entry_date,
        entry_type,
        amount,
        opening_balance,
        closing_balance,
        reference_type,
        reference_id,
        narration
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id`,
      [
        businessId,
        provisionId,
        financialYear,
        entryDate,
        entryType,
        amount,
        openingBalance,
        closingBalance,
        referenceType || null,
        referenceId || null,
        narration || null,
      ]
    );

    await client.query('COMMIT');
    return result.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get current balance of a provision
 */
async function getProvisionBalance(
  client: any,
  provisionId: string,
  financialYear: string,
  asOnDate: string
): Promise<number> {
  const result = await client.query(
    `SELECT closing_balance
     FROM provision_entries
     WHERE provision_id = $1
       AND financial_year = $2
       AND entry_date <= $3
     ORDER BY entry_date DESC, created_at DESC
     LIMIT 1`,
    [provisionId, financialYear, asOnDate]
  );

  if (result.rows.length > 0) {
    return parseFloat(result.rows[0].closing_balance || 0);
  }

  return 0;
}

/**
 * Get provision balance (public function)
 */
export async function getProvisionBalancePublic(
  provisionId: string,
  financialYear: string,
  asOnDate: string
): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    return await getProvisionBalance(client, provisionId, financialYear, asOnDate);
  } finally {
    client.release();
  }
}

/**
 * Get all provision entries for a financial year
 */
export async function getProvisionEntries(
  businessId: string,
  financialYear: string,
  provisionId?: string
): Promise<ProvisionEntry[]> {
  let sql = `
    SELECT pe.*
    FROM provision_entries pe
    WHERE pe.business_id = $1 AND pe.financial_year = $2
  `;
  const params: any[] = [businessId, financialYear];

  if (provisionId) {
    sql += ` AND pe.provision_id = $3`;
    params.push(provisionId);
  }

  sql += ` ORDER BY pe.entry_date DESC, pe.created_at DESC`;

  const entries = await queryRows<ProvisionEntry>(sql, params);
  return entries;
}

/**
 * Get total provisions for a financial year
 */
export async function getTotalProvisions(
  businessId: string,
  financialYear: string
): Promise<{
  total: number;
  by_type: Record<ProvisionType, number>;
  details: Array<{
    provision_id: string;
    provision_name: string;
    provision_type: ProvisionType;
    balance: number;
  }>;
}> {
  const provisions = await getProvisions(businessId);
  const asOnDate = new Date().toISOString().split('T')[0];

  const byType: Record<ProvisionType, number> = {
    bad_debts: 0,
    warranty: 0,
    gratuity: 0,
    leave_encashment: 0,
    employee_benefits: 0,
    litigation: 0,
    others: 0,
  };

  const details: Array<{
    provision_id: string;
    provision_name: string;
    provision_type: ProvisionType;
    balance: number;
  }> = [];

  let total = 0;

  for (const provision of provisions) {
    const balance = await getProvisionBalancePublic(
      provision.id,
      financialYear,
      asOnDate
    );

    byType[provision.provision_type] += balance;
    total += balance;

    details.push({
      provision_id: provision.id,
      provision_name: provision.provision_name,
      provision_type: provision.provision_type,
      balance,
    });
  }

  return {
    total,
    by_type: byType,
    details,
  };
}

/**
 * Calculate bad debts provision based on aging
 */
export async function calculateBadDebtsProvision(
  businessId: string,
  financialYear: string,
  asOnDate: string
): Promise<number> {
  // Get receivables aging
  const aging = await queryRows<{
    days: number;
    amount: number;
  }>(
    `SELECT 
      EXTRACT(DAY FROM ($1::date - i.invoice_date)) as days,
      SUM(i.balance_amount) as amount
    FROM invoices i
    WHERE i.business_id = $2
      AND i.status = 'final'
      AND i.balance_amount > 0
      AND i.invoice_date <= $1
    GROUP BY days
    HAVING EXTRACT(DAY FROM ($1::date - i.invoice_date)) > 90`,
    [asOnDate, businessId]
  );

  // Calculate provision: 10% for 90-180 days, 50% for 180-365 days, 100% for >365 days
  let provision = 0;

  for (const row of aging) {
    const days = parseInt(row.days.toString());
    const amount = parseFloat(row.amount.toString());

    if (days > 365) {
      provision += amount * 1.0; // 100%
    } else if (days > 180) {
      provision += amount * 0.5; // 50%
    } else if (days > 90) {
      provision += amount * 0.1; // 10%
    }
  }

  return provision;
}

/**
 * Post provision entry to ledger
 */
export async function postProvisionEntry(
  entryId: string,
  businessId: string,
  journalEntryId: string
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE provision_entries
       SET is_posted = true,
           posted_date = CURRENT_DATE,
           journal_entry_id = $1
       WHERE id = $2 AND business_id = $3`,
      [journalEntryId, entryId, businessId]
    );
  } finally {
    client.release();
  }
}

