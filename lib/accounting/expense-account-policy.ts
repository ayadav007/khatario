import { effectivePlSection, type PlAccountLike } from '@/lib/accounting/pl-sections';

/**
 * An expense category may debit only an operating-expense account.
 * The decision uses the account's stored P&L section (`accounts.pl_section`),
 * then the system-code and group defaults in `effectivePlSection`.
 * Purchases, COGS, stock losses, other expenses, assets, and liabilities are excluded.
 * Posting does not invent a debit account when the category has none.
 */
export function isOrdinaryOperatingExpenseAccount(account: PlAccountLike | null | undefined): boolean {
  if (!account) return false;
  if (account.account_type !== 'expense') return false;
  return effectivePlSection(account) === 'operating_expense';
}

export const EXPENSE_ACCOUNT_REQUIRED =
  'Select a category mapped to an active operating expense account.';

export const EXPENSE_ACCOUNT_REJECTED =
  'This category is not mapped to an active operating expense account. Purchases, cost of goods, stock losses, assets, and liabilities cannot be used on an expense.';
