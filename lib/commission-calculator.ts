/**
 * Commission Calculator
 * Calculates commission for employees based on commission rules
 */

import { queryRows, queryOne, query } from '@/lib/db';
import { CommissionRule, CommissionEarning } from '@/types/database';

export interface CommissionCalculationResult {
  commissionAmount: number;
  commissionRate: number;
  ruleId?: string;
  ruleType: 'employee' | 'role' | 'default';
}

export interface InvoiceForCommission {
  id: string;
  grand_total: number;
  created_by?: string;
  items?: Array<{
    item_id: string;
    quantity: number;
    price: number;
    item?: {
      category?: string;
    };
  }>;
  customer?: {
    customer_type?: string;
  };
}

/**
 * Get applicable commission rule for an employee and sale
 */
export async function getCommissionRule(
  businessId: string,
  employeeId: string,
  saleAmount: number,
  itemCategory?: string,
  customerType?: string
): Promise<CommissionRule | null> {
  // Priority: Employee-specific rule > Role-based rule
  // Check employee-specific rules first
  let rule = await queryOne<CommissionRule>(
    `SELECT * FROM commission_rules
     WHERE business_id = $1 AND employee_id = $2
     AND is_active = true
     AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
     AND (min_sale_amount IS NULL OR min_sale_amount <= $3)
     AND (applies_to_item_category IS NULL OR applies_to_item_category = $4)
     AND (applies_to_customer_type IS NULL OR applies_to_customer_type = $5)
     ORDER BY min_sale_amount DESC
     LIMIT 1`,
    [businessId, employeeId, saleAmount, itemCategory || null, customerType || null]
  );

  // If no employee-specific rule, check role-based rules
  if (!rule) {
    // Get employee's role
    const employee = await queryOne<{ role_id?: string }>(
      'SELECT role_id FROM users WHERE id = $1',
      [employeeId]
    );

    if (employee?.role_id) {
      rule = await queryOne<CommissionRule>(
        `SELECT * FROM commission_rules
         WHERE business_id = $1 AND role_id = $2
         AND employee_id IS NULL
         AND is_active = true
         AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
         AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
         AND (min_sale_amount IS NULL OR min_sale_amount <= $3)
         AND (applies_to_item_category IS NULL OR applies_to_item_category = $4)
         AND (applies_to_customer_type IS NULL OR applies_to_customer_type = $5)
         ORDER BY min_sale_amount DESC
         LIMIT 1`,
        [businessId, employee.role_id, saleAmount, itemCategory || null, customerType || null]
      );
    }
  }

  return rule;
}

/**
 * Calculate commission amount based on rule and sale amount
 */
export function calculateCommissionAmount(
  rule: CommissionRule,
  saleAmount: number
): number {
  let commissionAmount = 0;

  switch (rule.commission_type) {
    case 'percentage':
      commissionAmount = (saleAmount * rule.commission_value) / 100;
      break;

    case 'fixed':
      commissionAmount = rule.commission_value;
      break;

    case 'tiered':
      // For tiered, commission_value is the percentage for this tier
      // This is simplified - full tiered implementation would need tier definitions
      commissionAmount = (saleAmount * rule.commission_value) / 100;
      break;

    default:
      commissionAmount = 0;
  }

  // Apply max commission limit if set
  if (rule.max_commission && commissionAmount > rule.max_commission) {
    commissionAmount = rule.max_commission;
  }

  return Math.round(commissionAmount * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate commission for an invoice
 */
export async function calculateCommission(
  businessId: string,
  invoice: InvoiceForCommission
): Promise<CommissionCalculationResult | null> {
  if (!invoice.created_by) {
    return null; // No employee associated with invoice
  }

  const saleAmount = invoice.grand_total || 0;
  if (saleAmount <= 0) {
    return null; // No commission for zero/negative sales
  }

  // Get item category (use first item's category if available)
  const itemCategory = invoice.items?.[0]?.item?.category;
  const customerType = invoice.customer?.customer_type;

  // Get applicable commission rule
  const rule = await getCommissionRule(
    businessId,
    invoice.created_by,
    saleAmount,
    itemCategory,
    customerType
  );

  if (!rule) {
    return null; // No commission rule found
  }

  // Calculate commission amount
  const commissionAmount = calculateCommissionAmount(rule, saleAmount);

  if (commissionAmount <= 0) {
    return null;
  }

  return {
    commissionAmount,
    commissionRate: rule.commission_type === 'percentage' ? rule.commission_value : 0,
    ruleId: rule.id,
    ruleType: rule.employee_id ? 'employee' : 'role',
  };
}

/**
 * Process commission earning for an invoice
 * Creates commission_earnings record
 */
export async function processCommissionEarning(
  businessId: string,
  invoiceId: string,
  invoice: InvoiceForCommission
): Promise<CommissionEarning | null> {
  const calculation = await calculateCommission(businessId, invoice);

  if (!calculation || !invoice.created_by) {
    return null;
  }

  // Check if commission already exists for this invoice
  const existing = await queryOne(
    'SELECT id FROM commission_earnings WHERE invoice_id = $1',
    [invoiceId]
  );

  if (existing) {
    // Update existing commission
    const updated = await queryOne<CommissionEarning>(
      `UPDATE commission_earnings
       SET sale_amount = $1, commission_rate = $2, commission_amount = $3, updated_at = CURRENT_TIMESTAMP
       WHERE invoice_id = $4
       RETURNING *`,
      [
        invoice.grand_total || 0,
        calculation.commissionRate,
        calculation.commissionAmount,
        invoiceId,
      ]
    );
    return updated;
  }

  // Create new commission earning
  const earning = await queryOne<CommissionEarning>(
    `INSERT INTO commission_earnings (
      employee_id, invoice_id, sale_amount, commission_rate, commission_amount, status
    )
    VALUES ($1, $2, $3, $4, $5, 'pending')
    RETURNING *`,
    [
      invoice.created_by,
      invoiceId,
      invoice.grand_total || 0,
      calculation.commissionRate,
      calculation.commissionAmount,
    ]
  );

  // Update performance metrics (daily aggregation)
  await updatePerformanceMetrics(invoice.created_by, invoice.grand_total || 0, 1);

  return earning;
}

/**
 * Update employee performance metrics
 * Aggregates daily performance data
 */
export async function updatePerformanceMetrics(
  employeeId: string,
  saleAmount: number,
  invoiceCount: number = 1
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Get or create today's performance record
  let performance = await queryOne(
    'SELECT * FROM employee_performance WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
    [employeeId, 'daily', today]
  );

  if (performance) {
    // Update existing
    await query(
      `UPDATE employee_performance
       SET total_sales = total_sales + $1,
           total_invoices = total_invoices + $2,
           average_invoice_value = (total_sales + $1) / (total_invoices + $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [saleAmount, invoiceCount, performance.id]
    );
  } else {
    // Create new
    await query(
      `INSERT INTO employee_performance (
        employee_id, period_type, period_date, total_sales, total_invoices, average_invoice_value
      )
      VALUES ($1, 'daily', $2, $3, $4, $5)`,
      [employeeId, today, saleAmount, invoiceCount, saleAmount / invoiceCount]
    );
  }

  // Also update monthly performance
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

  let monthlyPerformance = await queryOne(
    'SELECT * FROM employee_performance WHERE employee_id = $1 AND period_type = $2 AND period_date = $3',
    [employeeId, 'monthly', monthStartStr]
  );

  if (monthlyPerformance) {
    await query(
      `UPDATE employee_performance
       SET total_sales = total_sales + $1,
           total_invoices = total_invoices + $2,
           average_invoice_value = (total_sales + $1) / (total_invoices + $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [saleAmount, invoiceCount, monthlyPerformance.id]
    );
  } else {
    await query(
      `INSERT INTO employee_performance (
        employee_id, period_type, period_date, total_sales, total_invoices, average_invoice_value
      )
      VALUES ($1, 'monthly', $2, $3, $4, $5)`,
      [employeeId, monthStartStr, saleAmount, invoiceCount, saleAmount / invoiceCount]
    );
  }
}

