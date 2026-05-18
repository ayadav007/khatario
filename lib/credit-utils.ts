/**
 * Credit Risk & Utilization Utilities
 * 
 * Computes credit metrics for customers and suppliers without modifying database schema.
 * All calculations are DERIVED from existing data.
 */

export type CreditStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'OVER_LIMIT' | 'UNLIMITED';

export interface CreditMetrics {
  credit_limit: number;
  current_balance: number;
  credit_used: number;
  available_credit: number | null; // null if unlimited
  credit_utilization_percent: number | null; // null if unlimited
  credit_status: CreditStatus;
}

/**
 * Calculate credit utilization metrics for a party (customer or supplier)
 * 
 * Rules:
 * - credit_used = max(0, current_balance)
 * - available_credit = credit_limit - credit_used
 * - credit_limit = 0 means unlimited (skip utilization)
 * - credit_utilization_percent = null if unlimited
 * 
 * Credit Status Classification:
 * - < 70% → HEALTHY
 * - 70–90% → WARNING
 * - 90–100% → CRITICAL
 * - > 100% → OVER_LIMIT
 * - credit_limit = 0 → UNLIMITED
 * 
 * @param creditLimit - Credit limit (0 means unlimited)
 * @param currentBalance - Current balance (can be negative for advances)
 * @returns CreditMetrics object
 */
export function calculateCreditMetrics(
  creditLimit: number | string | null,
  currentBalance: number | string | null
): CreditMetrics {
  const limit = parseFloat(creditLimit?.toString() ?? '0');
  const balance = parseFloat(currentBalance?.toString() ?? '0');
  
  // credit_limit = 0 means unlimited
  if (limit === 0) {
    return {
      credit_limit: 0,
      current_balance: balance,
      credit_used: Math.max(0, balance),
      available_credit: null, // Unlimited
      credit_utilization_percent: null, // Unlimited
      credit_status: 'UNLIMITED',
    };
  }

  // credit_used = max(0, current_balance)
  // Negative balance (advances) means 0 credit used
  const creditUsed = Math.max(0, balance);
  
  // available_credit = credit_limit - credit_used
  const availableCredit = limit - creditUsed;
  
  // credit_utilization_percent = (credit_used / credit_limit) * 100
  const utilizationPercent = (creditUsed / limit) * 100;
  
  // Determine credit status
  let creditStatus: CreditStatus;
  if (utilizationPercent < 70) {
    creditStatus = 'HEALTHY';
  } else if (utilizationPercent < 90) {
    creditStatus = 'WARNING';
  } else if (utilizationPercent <= 100) {
    creditStatus = 'CRITICAL';
  } else {
    creditStatus = 'OVER_LIMIT';
  }

  return {
    credit_limit: limit,
    current_balance: balance,
    credit_used: creditUsed,
    available_credit: availableCredit,
    credit_utilization_percent: utilizationPercent,
    credit_status: creditStatus,
  };
}

/**
 * Calculate projected credit metrics if a new transaction amount is added
 * 
 * @param creditLimit - Credit limit (0 means unlimited)
 * @param currentBalance - Current balance
 * @param newTransactionAmount - Amount of new transaction (positive for invoice/purchase, negative for payment)
 * @returns CreditMetrics object with projected values
 */
export function calculateProjectedCreditMetrics(
  creditLimit: number | string | null,
  currentBalance: number | string | null,
  newTransactionAmount: number
): CreditMetrics {
  const balance = parseFloat(currentBalance?.toString() ?? '0');
  const projectedBalance = balance + newTransactionAmount;
  
  return calculateCreditMetrics(creditLimit, projectedBalance);
}

/**
 * Get credit warning message for frontend display
 * 
 * @param metrics - CreditMetrics object
 * @param partyType - 'customer' or 'supplier'
 * @param projectedMetrics - Optional projected metrics (if new transaction is being added)
 * @returns Warning message or null if no warning needed
 */
export function getCreditWarningMessage(
  metrics: CreditMetrics,
  partyType: 'customer' | 'supplier',
  projectedMetrics?: CreditMetrics
): string | null {
  // Use projected metrics if provided, otherwise use current metrics
  const displayMetrics = projectedMetrics || metrics;
  
  // Only show warning if utilization >= 70%
  if (displayMetrics.credit_status === 'UNLIMITED') {
    return null;
  }
  
  if (displayMetrics.credit_utilization_percent === null) {
    return null;
  }
  
  if (displayMetrics.credit_utilization_percent < 70) {
    return null;
  }

  const partyLabel = partyType === 'customer' ? 'customer' : 'supplier';
  const balanceLabel = partyType === 'customer' ? 'receivable' : 'payable';
  
  let message = '';
  
  if (projectedMetrics) {
    // Projected warning (during invoice/purchase creation)
    if (displayMetrics.credit_status === 'OVER_LIMIT') {
      message = `This transaction will push the ${partyLabel} over their credit limit (${displayMetrics.credit_utilization_percent.toFixed(1)}% utilized).`;
    } else if (displayMetrics.credit_status === 'CRITICAL') {
      message = `This transaction will push the ${partyLabel} to ${displayMetrics.credit_utilization_percent.toFixed(1)}% of their credit limit (CRITICAL).`;
    } else {
      message = `This transaction will push the ${partyLabel} to ${displayMetrics.credit_utilization_percent.toFixed(1)}% of their credit limit.`;
    }
  } else {
    // Current warning (existing balance)
    if (displayMetrics.credit_status === 'OVER_LIMIT') {
      message = `${partyLabel.charAt(0).toUpperCase() + partyLabel.slice(1)} has exceeded their credit limit (${displayMetrics.credit_utilization_percent.toFixed(1)}% utilized).`;
    } else if (displayMetrics.credit_status === 'CRITICAL') {
      message = `${partyLabel.charAt(0).toUpperCase() + partyLabel.slice(1)} is at ${displayMetrics.credit_utilization_percent.toFixed(1)}% of their credit limit (CRITICAL).`;
    } else {
      message = `${partyLabel.charAt(0).toUpperCase() + partyLabel.slice(1)} is at ${displayMetrics.credit_utilization_percent.toFixed(1)}% of their credit limit.`;
    }
  }
  
  return message;
}
