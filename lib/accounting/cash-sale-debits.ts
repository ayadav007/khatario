export type CashSalePayment = { mode?: string | null; amount?: number | null };

export type CashSaleDebit = { mode: string; amount: number };

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
  const grouped = new Map<string, number>();
  for (const payment of payments) {
    const amount = money(Number(payment.amount) || 0);
    if (amount <= 0) continue;
    const mode = String(payment.mode || 'cash').trim().toLowerCase() || 'cash';
    grouped.set(mode, money((grouped.get(mode) || 0) + amount));
  }
  const lines = [...grouped.entries()].map(([mode, amount]) => ({ mode, amount }));
  if (lines.length === 0) return null;
  const sum = money(lines.reduce((total, line) => total + line.amount, 0));
  if (Math.abs(sum - money(Number(grandTotal) || 0)) > 0.01) return null;
  return lines;
}
