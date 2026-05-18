/**
 * UI copy for signed party balances (customers.current_balance / suppliers.current_balance).
 * Positive customer balance = they owe you; negative = advance/credit from them.
 * Positive supplier balance = you owe supplier; negative = you prepaid.
 */

const EPS = 0.005;

export function isPartyBalanceSettled(balance: number): boolean {
  return Math.abs(balance) < EPS;
}

/** Customer: summary card title */
export function customerBalanceCardTitle(balance: number): string {
  if (balance > EPS) return 'Amount due';
  if (balance < -EPS) return 'Advance / credit';
  return 'Account balance';
}

/** Customer: short hint under amount in lists */
export function customerBalanceHint(balance: number): string {
  if (balance > EPS) return 'Due';
  if (balance < -EPS) return 'Credit';
  return 'Settled';
}

/** Supplier: summary card title */
export function supplierBalanceCardTitle(balance: number): string {
  if (balance > EPS) return 'Amount payable';
  if (balance < -EPS) return 'Advance paid';
  return 'Account balance';
}

/** Supplier: short hint under amount in lists */
export function supplierBalanceHint(balance: number): string {
  if (balance > EPS) return 'Due';
  if (balance < -EPS) return 'Prepaid';
  return 'Settled';
}

export const PARTY_BALANCE_COLUMN_HEADER = 'Balance';
