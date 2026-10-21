export type CashSalePayment = {
  mode?: string | null;
  amount?: number | null;
  settlementAccountId?: string | null;
};

export type CashSaleDebit = { mode: string; amount: number; settlementAccountId?: string | null };

function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Walk-in bills have no receivable. When the recorded payments add up to the
 * bill total, each mode is its own cash or bank debit. A short or over
 * collection stays on the single cash line the caller already posts.
 */
export function cashSaleDebitLines(
  grandTotal: number,
  payments: CashSalePayment[],
): CashSaleDebit[] | null {
  const grouped = new Map<string, CashSaleDebit>();
  for (const payment of payments) {
    const amount = money(Number(payment.amount) || 0);
    if (amount <= 0) continue;
    const mode = String(payment.mode || 'cash').trim().toLowerCase() || 'cash';
    const settlementAccountId = payment.settlementAccountId || undefined;
    const key = `${mode}|${settlementAccountId || ''}`;
    const prev = grouped.get(key) || { mode, amount: 0, ...(settlementAccountId ? { settlementAccountId } : {}) };
    grouped.set(key, { ...prev, amount: money(prev.amount + amount) });
  }
  const lines = [...grouped.values()];
  if (lines.length === 0) return null;
  const sum = money(lines.reduce((total, line) => total + line.amount, 0));
  if (Math.abs(sum - money(Number(grandTotal) || 0)) > 0.01) return null;
  return lines;
}
