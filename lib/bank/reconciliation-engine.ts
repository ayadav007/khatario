/**
 * Bank ↔ ledger matching (suggestions only — never auto-posts).
 * Convention: bank statement credit (inflow) ↔ ledger debit on bank account;
 * bank debit (outflow) ↔ ledger credit on bank account.
 */

import { extractReferencesFromDescription } from '@/lib/bank/reference-extract';

export type BankLineInput = {
  id: string;
  transaction_date: string; // YYYY-MM-DD
  description: string;
  debit_amount: number;
  credit_amount: number;
};

export type LedgerLineInput = {
  id: string;
  entry_date: string;
  debit: number;
  credit: number;
  narration: string | null;
  reference_number: string | null;
};

export type MatchTier = 'exact' | 'reference' | 'fuzzy';

export type MatchConfidence = 'high' | 'medium' | 'low';

export type MatchSuggestion = {
  bankLineId: string;
  ledgerLineIds: string[];
  tier: MatchTier;
  confidence: MatchConfidence;
  /** Set for reference-tier rows (token overlap 0–1). */
  referenceScore?: number;
};

/** Safe auto-match: exact date+amount, or strong reference overlap only (never fuzzy). */
export function suggestionIsHighConfidenceAutoMatch(s: MatchSuggestion): boolean {
  if (s.tier === 'exact') return true;
  if (s.tier === 'reference' && s.confidence === 'high') return true;
  return false;
}

export type ReconciliationEngineResult = {
  suggestions: MatchSuggestion[];
  unmatchedBankIds: string[];
  unmatchedLedgerIds: string[];
};

const MS_DAY = 86_400_000;

function parseYmd(s: string): number {
  const t = Date.parse(`${s}T12:00:00`);
  return Number.isFinite(t) ? t : NaN;
}

function daysBetween(a: string, b: string): number {
  const ta = parseYmd(a);
  const tb = parseYmd(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 999;
  return Math.abs(ta - tb) / MS_DAY;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function wantLedgerSides(line: BankLineInput): { debit: number; credit: number } {
  const d = round2(line.debit_amount);
  const c = round2(line.credit_amount);
  if (c > 0.005) return { debit: c, credit: 0 };
  if (d > 0.005) return { debit: 0, credit: d };
  return { debit: 0, credit: 0 };
}

function normText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normText(a).split(' ').filter((x) => x.length > 2));
  const tb = new Set(normText(b).split(' ').filter((x) => x.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const x of ta) {
    if (tb.has(x)) hit++;
  }
  return hit / Math.max(ta.size, tb.size);
}

type IndexedLedger = LedgerLineInput & { _key: string };

function ledgerKey(debit: number, credit: number): string {
  return `${Math.round(debit * 100)}_${Math.round(credit * 100)}`;
}

/**
 * Uses amount indexes + date windows; O(n) typical with hash maps.
 */
export function runBankReconciliationEngine(input: {
  bankLines: BankLineInput[];
  ledgerLines: LedgerLineInput[];
  dateToleranceDays?: number;
  fuzzyAbs?: number;
}): ReconciliationEngineResult {
  const dateTol = input.dateToleranceDays ?? 2;
  const fuzzyAbs = input.fuzzyAbs ?? 1.0;

  const suggestions: MatchSuggestion[] = [];
  const usedLedger = new Set<string>();
  const matchedBank = new Set<string>();

  const ledgerIndexed: IndexedLedger[] = input.ledgerLines.map((l) => ({
    ...l,
    _key: ledgerKey(l.debit, l.credit),
  }));

  const byExactKey = new Map<string, IndexedLedger[]>();
  for (const le of ledgerIndexed) {
    if (!byExactKey.has(le._key)) byExactKey.set(le._key, []);
    byExactKey.get(le._key)!.push(le);
  }

  /** Round net for fuzzy bucket: bank inflow positive */
  const byNet = new Map<string, IndexedLedger[]>();
  for (const le of ledgerIndexed) {
    const net = Math.round((le.debit - le.credit) * 100);
    const k = String(net);
    if (!byNet.has(k)) byNet.set(k, []);
    byNet.get(k)!.push(le);
  }

  function pickExact(bank: BankLineInput): IndexedLedger | null {
    const { debit, credit } = wantLedgerSides(bank);
    const k = ledgerKey(debit, credit);
    const cands = byExactKey.get(k);
    if (!cands?.length) return null;
    let best: IndexedLedger | null = null;
    let bestDay = 999;
    for (const le of cands) {
      if (usedLedger.has(le.id)) continue;
      const dd = daysBetween(bank.transaction_date, le.entry_date);
      if (dd <= dateTol && dd < bestDay) {
        bestDay = dd;
        best = le;
      }
    }
    return best;
  }

  function pickFuzzy(bank: BankLineInput): IndexedLedger | null {
    const { debit, credit } = wantLedgerSides(bank);
    const targetNet = debit - credit;
    const rounded = Math.round(targetNet * 100);
    for (let delta = -Math.ceil(fuzzyAbs * 100); delta <= Math.ceil(fuzzyAbs * 100); delta++) {
      const k = String(rounded + delta);
      const cands = byNet.get(k);
      if (!cands) continue;
      let best: IndexedLedger | null = null;
      let bestDay = 999;
      for (const le of cands) {
        if (usedLedger.has(le.id)) continue;
        const dd = daysBetween(bank.transaction_date, le.entry_date);
        if (dd <= dateTol && dd < bestDay) {
          const netL = le.debit - le.credit;
          if (Math.abs(netL - targetNet) <= fuzzyAbs + 0.001) {
            bestDay = dd;
            best = le;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  function pickReference(bank: BankLineInput): { le: IndexedLedger; score: number } | null {
    const { debit, credit } = wantLedgerSides(bank);
    const k = ledgerKey(debit, credit);
    const cands = byExactKey.get(k);
    if (!cands?.length) return null;
    let best: IndexedLedger | null = null;
    let bestScore = 0;
    for (const le of cands) {
      if (usedLedger.has(le.id)) continue;
      if (daysBetween(bank.transaction_date, le.entry_date) > dateTol) continue;
      const nar = [le.narration, le.reference_number].filter(Boolean).join(' ');
      let score = tokenOverlap(bank.description, nar);
      const br = extractReferencesFromDescription(bank.description);
      const leRef = `${le.reference_number || ''} ${le.narration || ''}`;
      if (br.long_numeric_refs.length && leRef) {
        for (const x of br.long_numeric_refs) {
          if (leRef.includes(x)) {
            score = Math.max(score, 0.55);
            break;
          }
        }
      }
      if (score > bestScore && score >= 0.34) {
        bestScore = score;
        best = le;
      }
    }
    return best && bestScore > 0 ? { le: best, score: bestScore } : null;
  }

  for (const bank of input.bankLines) {
    const ex = pickExact(bank);
    if (ex) {
      suggestions.push({
        bankLineId: bank.id,
        ledgerLineIds: [ex.id],
        tier: 'exact',
        confidence: 'high',
      });
      usedLedger.add(ex.id);
      matchedBank.add(bank.id);
      continue;
    }
  }

  for (const bank of input.bankLines) {
    if (matchedBank.has(bank.id)) continue;
    const ref = pickReference(bank);
    if (ref) {
      const conf: MatchConfidence = ref.score >= 0.5 ? 'high' : 'medium';
      suggestions.push({
        bankLineId: bank.id,
        ledgerLineIds: [ref.le.id],
        tier: 'reference',
        confidence: conf,
        referenceScore: ref.score,
      });
      usedLedger.add(ref.le.id);
      matchedBank.add(bank.id);
    }
  }

  for (const bank of input.bankLines) {
    if (matchedBank.has(bank.id)) continue;
    const fz = pickFuzzy(bank);
    if (fz) {
      suggestions.push({
        bankLineId: bank.id,
        ledgerLineIds: [fz.id],
        tier: 'fuzzy',
        confidence: 'low',
      });
      usedLedger.add(fz.id);
      matchedBank.add(bank.id);
    }
  }

  const unmatchedBankIds = input.bankLines.map((b) => b.id).filter((id) => !matchedBank.has(id));
  const unmatchedLedgerIds = input.ledgerLines.map((l) => l.id).filter((id) => !usedLedger.has(id));

  return { suggestions, unmatchedBankIds, unmatchedLedgerIds };
}
