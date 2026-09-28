export type JournalLineInput = {
  account_id?: string;
  debit?: number | string;
  credit?: number | string;
  narration?: string;
};

export function toJournalAmount(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Returns an error message, or null when the lines form a valid balanced voucher. */
export function validateJournalLines(lines: JournalLineInput[]): string | null {
  if (!Array.isArray(lines) || lines.length < 2) return 'At least 2 lines are required';
  let dr = 0;
  let cr = 0;
  for (const line of lines) {
    const d = toJournalAmount(line.debit);
    const c = toJournalAmount(line.credit);
    if (!line.account_id) return 'All lines must have an account_id';
    if (Number.isNaN(d) || Number.isNaN(c) || d < 0 || c < 0) return 'Amounts must be non-negative numbers';
    if (d > 0 && c > 0) return 'Each line must have either debit or credit, not both';
    if (d === 0 && c === 0) return 'Each line must have either debit or credit';
    dr += d;
    cr += c;
  }
  if (Math.abs(dr - cr) > 0.001) {
    return `Debit and Credit must be equal. Debit: ${dr.toFixed(2)}, Credit: ${cr.toFixed(2)}`;
  }
  return null;
}
