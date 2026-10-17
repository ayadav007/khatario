/**
 * Pending ITC decisions for one open month. Only `known` has a number.
 */

export type PendingDecision =
  | 'PENDING_SUPPLIER_CORRECTION'
  | 'ITC_ELIGIBLE_THIS_PERIOD'
  | 'ITC_DEFERRED_TO_FUTURE'
  | 'ITC_NOT_ELIGIBLE'
  | 'IGNORE'
  | null;

export interface PendingRow {
  matchStatus: string;
  decision: PendingDecision;
  deferredToPeriod: string | null;
  /** Absolute tax difference, rupees. Within ₹1 is treated as matched rounding. */
  taxDifference: number;
  ambiguous?: boolean;
}

export type PendingCount =
  | { state: 'known'; count: number }
  | { state: 'not_imported' }
  | { state: 'stale' };

const COMPLETED = new Set(['ITC_NOT_ELIGIBLE', 'IGNORE']);

export function rowIsPending(row: PendingRow, openPeriod: string): boolean {
  if (row.ambiguous) return true;
  const matched = row.matchStatus === 'MATCHED' && row.taxDifference <= 1;
  if (!row.decision) return !matched;
  if (row.decision === 'PENDING_SUPPLIER_CORRECTION') return true;
  if (row.decision === 'ITC_DEFERRED_TO_FUTURE') {
    return row.deferredToPeriod === openPeriod;
  }
  if (COMPLETED.has(row.decision)) return false;
  if (row.decision === 'ITC_ELIGIBLE_THIS_PERIOD') {
    if (row.matchStatus === 'MISSING_IN_2B' || row.matchStatus === 'NOT_ELIGIBLE') return true;
    return false;
  }
  return false;
}

export function countPendingItc(input: {
  imported: boolean;
  stale: boolean;
  openPeriod: string;
  rows: PendingRow[];
}): PendingCount {
  if (!input.imported) return { state: 'not_imported' };
  if (input.stale) return { state: 'stale' };
  return {
    state: 'known',
    count: input.rows.filter((row) => rowIsPending(row, input.openPeriod)).length,
  };
}

/** What the dashboard menu may show. A missing or stale period has a label and no number. */
export function itcMenuPresentation(body: { state?: string; count?: number; label?: string } | null): {
  count: number | null;
  note: string | null;
} {
  if (!body) return { count: null, note: null };
  if (body.state === 'known') return { count: Number(body.count) || 0, note: null };
  return { count: null, note: body.label || 'ITC count is not available' };
}
