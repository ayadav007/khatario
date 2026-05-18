/**
 * Pure UI helpers for bank reconciliation (no API calls).
 */

import type { MatchSuggestion } from '@/lib/bank/reconciliation-engine';

export function parseAmt(s: string | undefined): number {
  const x = parseFloat(s || '0');
  return Number.isFinite(x) ? x : 0;
}

export function bankLineFlow(line: { debit_amount: string; credit_amount: string }): {
  inflow: boolean;
  amount: number;
} {
  const d = parseAmt(line.debit_amount);
  const c = parseAmt(line.credit_amount);
  if (c > 0.005) return { inflow: true, amount: c };
  if (d > 0.005) return { inflow: false, amount: d };
  return { inflow: false, amount: 0 };
}

const MS_DAY = 86_400_000;

export function daysBetweenDates(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00`);
  const tb = Date.parse(`${b}T12:00:00`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999;
  return Math.round(Math.abs(ta - tb) / MS_DAY);
}

export type StatementLineLike = {
  transaction_date: string;
  debit_amount: string;
  credit_amount: string;
  extracted_references?: { long_numeric_refs: string[]; cheque_refs: string[] };
};

export type LedgerLineLike = {
  id: string;
  entry_date: string;
  debit: string;
  credit: string;
  narration: string | null;
  reference_number: string | null;
};

/** Amount on the bank leg (non-zero side). */
export function ledgerBankSideAmount(ledger: LedgerLineLike): number {
  const d = parseAmt(ledger.debit);
  const cr = parseAmt(ledger.credit);
  return d > 0.005 ? d : cr;
}

export function utrMatched(bankLine: StatementLineLike, ledger: LedgerLineLike): boolean {
  const refs = bankLine.extracted_references?.long_numeric_refs ?? [];
  if (!refs.length) return false;
  const leRef = `${ledger.reference_number || ''} ${ledger.narration || ''}`;
  return refs.some((r) => leRef.includes(r));
}

export function suggestionHeadline(
  s: MatchSuggestion,
  bankLine: StatementLineLike,
  ledgerById: Map<string, LedgerLineLike>,
  fmt: (n: string | number) => string
): string {
  const flow = bankLineFlow(bankLine);
  const main = `₹${fmt(flow.amount)}`;
  const le = s.ledgerLineIds[0] ? ledgerById.get(s.ledgerLineIds[0]) : undefined;

  if (s.tier === 'exact') {
    const dd = le ? daysBetweenDates(bankLine.transaction_date, le.entry_date) : 0;
    const datePart = dd === 0 ? 'date matched' : dd <= 2 ? 'date matched' : `${dd}d apart`;
    return `Exact match (${main}, ${datePart})`;
  }

  if (s.tier === 'reference') {
    if (le && utrMatched(bankLine, le)) return 'Reference match (UTR found)';
    return 'Reference match (text / reference similarity)';
  }

  if (le) {
    const la = ledgerBankSideAmount(le);
    return `Fuzzy match (₹${fmt(flow.amount)} ≈ ₹${fmt(la)})`;
  }
  return `Fuzzy match (${main})`;
}

/** Plain-text tooltip (use with `title` or custom popover). */
export function matchReasonTooltipText(
  s: MatchSuggestion,
  bankLine: StatementLineLike,
  ledgerById: Map<string, LedgerLineLike>
): string {
  const lines: string[] = [];
  const flow = bankLineFlow(bankLine);
  const le = s.ledgerLineIds[0] ? ledgerById.get(s.ledgerLineIds[0]) : undefined;

  if (s.tier === 'exact') {
    lines.push('Amount exact');
    if (le) {
      const dd = daysBetweenDates(bankLine.transaction_date, le.entry_date);
      lines.push(dd === 0 ? 'Same date' : `Date within ${dd} day(s) (engine tolerance ±2 days)`);
    }
  } else if (s.tier === 'reference') {
    lines.push('Same amount on bank ledger leg');
    if (le) {
      const dd = daysBetweenDates(bankLine.transaction_date, le.entry_date);
      lines.push(dd === 0 ? 'Same date' : `Date within ${dd} day(s)`);
      if (utrMatched(bankLine, le)) lines.push('UTR / long reference found in narration or reference #');
      else lines.push('Description overlap with ledger narration');
      if (s.referenceScore != null) lines.push(`Reference score ~${Math.round(s.referenceScore * 100)}%`);
    }
  } else {
    lines.push('Amount within ₹1 fuzzy tolerance');
    if (le) {
      const dd = daysBetweenDates(bankLine.transaction_date, le.entry_date);
      lines.push(`Date within ${dd} day(s)`);
      const la = ledgerBankSideAmount(le);
      lines.push(
        `Bank ${flow.inflow ? 'credit' : 'debit'} vs ledger ₹${flow.amount.toFixed(2)} / ₹${la.toFixed(2)}`
      );
    }
    lines.push('Low confidence — confirm before accepting');
  }

  return ['Matched because:', ...lines.map((x) => `• ${x}`)].join('\n');
}

export function tierBadgeClass(tier: MatchSuggestion['tier']): string {
  switch (tier) {
    case 'exact':
      return 'bg-green-100 text-green-900 border-green-200';
    case 'reference':
      return 'bg-sky-100 text-sky-900 border-sky-200';
    case 'fuzzy':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export function partialBreakdownRows(
  matchedIds: string[],
  ledgerById: Map<string, LedgerLineLike>
): { id: string; label: string; amount: number }[] {
  return matchedIds.map((id) => {
    const le = ledgerById.get(id);
    if (!le) return { id, label: 'Ledger line (not in current window)', amount: 0 };
    const amt = ledgerBankSideAmount(le);
    const ref = le.reference_number ? `#${le.reference_number}` : '';
    const narr = (le.narration || '').trim().slice(0, 72);
    const label = [ref, narr || 'Ledger entry'].filter(Boolean).join(' — ');
    return { id, label: label || 'Ledger entry', amount: amt };
  });
}
