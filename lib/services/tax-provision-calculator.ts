/**
 * Tax Provision Calculator Service
 * Calculates current tax and deferred tax provisions
 */

import { queryRows, queryOne, getPool } from '@/lib/db';

export type TaxType = 'current_tax' | 'deferred_tax';

export interface TaxProvision {
  id: string;
  business_id: string;
  financial_year: string;
  tax_type: TaxType;
  tax_account_id: string;
  expense_account_id: string;
  provision_amount: number;
  paid_amount: number;
  balance_amount: number;
  tax_rate?: number;
  taxable_income?: number;
  calculation_method?: string;
  calculation_details?: any;
  due_date?: string;
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
}

export interface DeferredTaxDetail {
  timing_difference_type: string;
  book_value: number;
  tax_value: number;
  difference: number;
  tax_rate: number;
  deferred_tax_amount: number;
  is_asset: boolean;
}

/**
 * Calculate current tax provision
 * @param profitBeforeTax Profit before tax from P&L
 * @param taxRate Tax rate percentage (e.g., 30 for 30%)
 */
export function calculateCurrentTax(
  profitBeforeTax: number,
  taxRate: number
): number {
  if (profitBeforeTax <= 0) return 0;
  return (profitBeforeTax * taxRate) / 100;
}

/**
 * Create or update tax provision
 */
export async function createOrUpdateTaxProvision(
  businessId: string,
  financialYear: string,
  taxType: TaxType,
  provisionAmount: number,
  taxAccountId: string,
  expenseAccountId: string,
  taxRate?: number,
  taxableIncome?: number,
  calculationMethod?: string,
  calculationDetails?: any,
  dueDate?: string
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    // Check if provision exists
    const existing = await client.query(
      `SELECT id, paid_amount FROM tax_provisions
       WHERE business_id = $1 AND financial_year = $2 AND tax_type = $3`,
      [businessId, financialYear, taxType]
    );

    const paidAmount = existing.rows.length > 0
      ? parseFloat(existing.rows[0].paid_amount || 0)
      : 0;

    const balanceAmount = provisionAmount - paidAmount;
    const paymentStatus = balanceAmount <= 0
      ? 'paid'
      : paidAmount > 0
      ? 'partially_paid'
      : 'unpaid';

    if (existing.rows.length > 0) {
      // Update existing
      await client.query(
        `UPDATE tax_provisions
         SET provision_amount = $1,
             balance_amount = $2,
             payment_status = $3,
             tax_rate = $4,
             taxable_income = $5,
             calculation_method = $6,
             calculation_details = $7,
             due_date = $8,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $9`,
        [
          provisionAmount,
          balanceAmount,
          paymentStatus,
          taxRate || null,
          taxableIncome || null,
          calculationMethod || null,
          calculationDetails ? JSON.stringify(calculationDetails) : null,
          dueDate || null,
          existing.rows[0].id,
        ]
      );
      return existing.rows[0].id;
    } else {
      // Create new
      const result = await client.query(
        `INSERT INTO tax_provisions (
          business_id,
          financial_year,
          tax_type,
          tax_account_id,
          expense_account_id,
          provision_amount,
          balance_amount,
          tax_rate,
          taxable_income,
          calculation_method,
          calculation_details,
          due_date,
          payment_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          businessId,
          financialYear,
          taxType,
          taxAccountId,
          expenseAccountId,
          provisionAmount,
          balanceAmount,
          taxRate || null,
          taxableIncome || null,
          calculationMethod || null,
          calculationDetails ? JSON.stringify(calculationDetails) : null,
          dueDate || null,
          paymentStatus,
        ]
      );
      return result.rows[0].id;
    }
  } finally {
    client.release();
  }
}

/**
 * Get tax provision for a financial year
 */
export async function getTaxProvision(
  businessId: string,
  financialYear: string,
  taxType: TaxType
): Promise<TaxProvision | null> {
  const provision = await queryOne<TaxProvision>(
    `SELECT * FROM tax_provisions
     WHERE business_id = $1 AND financial_year = $2 AND tax_type = $3`,
    [businessId, financialYear, taxType]
  );

  if (!provision) return null;

  return {
    ...provision,
    provision_amount: parseFloat(provision.provision_amount?.toString() || '0'),
    paid_amount: parseFloat(provision.paid_amount?.toString() || '0'),
    balance_amount: parseFloat(provision.balance_amount?.toString() || '0'),
    tax_rate: provision.tax_rate ? parseFloat(provision.tax_rate.toString()) : undefined,
    taxable_income: provision.taxable_income ? parseFloat(provision.taxable_income.toString()) : undefined,
    calculation_details: provision.calculation_details
      ? (typeof provision.calculation_details === 'string'
          ? JSON.parse(provision.calculation_details)
          : provision.calculation_details)
      : undefined,
  };
}

/**
 * Get all tax provisions for a financial year
 */
export async function getAllTaxProvisions(
  businessId: string,
  financialYear: string
): Promise<{
  current_tax: TaxProvision | null;
  deferred_tax: TaxProvision | null;
  total_tax: number;
}> {
  const currentTax = await getTaxProvision(businessId, financialYear, 'current_tax');
  const deferredTax = await getTaxProvision(businessId, financialYear, 'deferred_tax');

  const totalTax = (currentTax?.provision_amount || 0) + (deferredTax?.provision_amount || 0);

  return {
    current_tax: currentTax,
    deferred_tax: deferredTax,
    total_tax: totalTax,
  };
}

/**
 * Record tax payment
 */
export async function recordTaxPayment(
  businessId: string,
  taxProvisionId: string,
  paymentDate: string,
  paymentAmount: number,
  paymentMode?: string,
  challanNumber?: string,
  bankName?: string,
  referenceNumber?: string,
  notes?: string,
  userId?: string
): Promise<string> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Insert payment record
    const paymentResult = await client.query(
      `INSERT INTO tax_payments (
        business_id,
        tax_provision_id,
        payment_date,
        payment_amount,
        payment_mode,
        challan_number,
        bank_name,
        reference_number,
        notes,
        created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        businessId,
        taxProvisionId,
        paymentDate,
        paymentAmount,
        paymentMode || null,
        challanNumber || null,
        bankName || null,
        referenceNumber || null,
        notes || null,
        userId || null,
      ]
    );

    // Update tax provision
    const provision = await client.query(
      `SELECT provision_amount, paid_amount FROM tax_provisions WHERE id = $1`,
      [taxProvisionId]
    );

    if (provision.rows.length > 0) {
      const newPaidAmount =
        parseFloat(provision.rows[0].paid_amount || 0) + paymentAmount;
      const provisionAmount = parseFloat(provision.rows[0].provision_amount || 0);
      const balanceAmount = provisionAmount - newPaidAmount;
      const paymentStatus =
        balanceAmount <= 0
          ? 'paid'
          : newPaidAmount > 0
          ? 'partially_paid'
          : 'unpaid';

      await client.query(
        `UPDATE tax_provisions
         SET paid_amount = $1,
             balance_amount = $2,
             payment_status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [newPaidAmount, balanceAmount, paymentStatus, taxProvisionId]
      );
    }

    await client.query('COMMIT');
    return paymentResult.rows[0].id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Calculate deferred tax based on timing differences
 */
export async function calculateDeferredTax(
  businessId: string,
  financialYear: string,
  taxRate: number
): Promise<{
  deferred_tax_assets: number;
  deferred_tax_liabilities: number;
  net_deferred_tax: number;
  details: DeferredTaxDetail[];
}> {
  // Get timing differences from various sources
  // This is a simplified version - in practice, you'd calculate from:
  // - Depreciation differences (book vs tax)
  // - Provision differences
  // - Revenue recognition differences
  // etc.

  const details: DeferredTaxDetail[] = [];
  let totalDTA = 0;
  let totalDTL = 0;

  // Example: Depreciation timing difference
  // (This would be calculated from actual depreciation schedules)
  // For now, returning empty - this should be implemented based on actual business logic

  return {
    deferred_tax_assets: totalDTA,
    deferred_tax_liabilities: totalDTL,
    net_deferred_tax: totalDTA - totalDTL,
    details,
  };
}

/**
 * Get tax payments for a provision
 */
export async function getTaxPayments(
  taxProvisionId: string
): Promise<Array<{
  id: string;
  payment_date: string;
  payment_amount: number;
  payment_mode?: string;
  challan_number?: string;
}>> {
  const payments = await queryRows<{
    id: string;
    payment_date: string;
    payment_amount: number;
    payment_mode?: string;
    challan_number?: string;
  }>(
    `SELECT 
      id,
      payment_date,
      payment_amount,
      payment_mode,
      challan_number
    FROM tax_payments
    WHERE tax_provision_id = $1
    ORDER BY payment_date DESC`,
    [taxProvisionId]
  );

  return payments.map((p) => ({
    ...p,
    payment_amount: parseFloat(p.payment_amount?.toString() || '0'),
  }));
}

