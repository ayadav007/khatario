/**
 * Receivable / payable ageing built from control-account (1103 / 2101) ledger lines, so the
 * report total always equals the GL balance as of the date. Settlements (receipts, notes, TDS)
 * are applied to the document they reference first, then oldest-first (FIFO).
 */

export type AgeingDoc = {
  voucherType: string;
  voucherId: string;
  partyId: string | null;
  partyName: string | null;
  partyPhone: string | null;
  reference: string;
  docDate: string;
  dueDate: string | null;
  /** Positive increases the outstanding (invoice / bill), negative settles it. */
  amount: number;
  /** Document this settlement references (payment.reference_id, credit_note.invoice_id, …). */
  linkedVoucherId: string | null;
};

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+';

export type AgeingRow = {
  party_id: string | null;
  party_name: string;
  party_phone: string | null;
  transaction_id: string | null;
  transaction_type: string;
  reference_number: string;
  invoice_date: string;
  due_date: string | null;
  original_amount: number;
  outstanding: number;
  days_old: number;
  age_bucket: AgeingBucket;
};

export type AgeingPartySummary = {
  party_id: string | null;
  party_name: string;
  party_phone: string | null;
  transactions: AgeingRow[];
  age_0_30: number;
  age_30_60: number;
  age_60_90: number;
  age_90_plus: number;
  /** Legacy combined bucket (61+ days). */
  age_60_plus: number;
  on_account: number;
  total: number;
};

export type AgeingTotals = Omit<AgeingPartySummary, 'party_id' | 'party_name' | 'party_phone' | 'transactions'>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 0.005;
export const UNALLOCATED_PARTY = 'Unallocated (journals / other)';

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function bucketFor(days: number): AgeingBucket {
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

const byDate = (a: AgeingDoc, b: AgeingDoc) =>
  a.docDate === b.docDate ? a.reference.localeCompare(b.reference) : a.docDate < b.docDate ? -1 : 1;

/** Allocates one party's settlements against its documents; returns the open items. */
export function allocateParty(docs: AgeingDoc[], asOfDate: string): AgeingRow[] {
  const debits = docs.filter((d) => d.amount > EPS).sort(byDate).map((d) => ({ doc: d, open: d.amount }));
  const credits = docs.filter((d) => d.amount < -EPS).sort(byDate).map((d) => ({ doc: d, left: -d.amount }));
  const byId = new Map(debits.map((d) => [d.doc.voucherId, d]));

  for (const c of credits) {
    const target = c.doc.linkedVoucherId ? byId.get(c.doc.linkedVoucherId) : undefined;
    if (target && target.open > EPS) {
      const applied = Math.min(target.open, c.left);
      target.open -= applied;
      c.left -= applied;
    }
  }
  for (const c of credits) {
    for (const d of debits) {
      if (c.left <= EPS) break;
      if (d.open <= EPS) continue;
      const applied = Math.min(d.open, c.left);
      d.open -= applied;
      c.left -= applied;
    }
  }

  const row = (doc: AgeingDoc, outstanding: number): AgeingRow => {
    const days = Math.max(0, daysBetween(doc.dueDate || doc.docDate, asOfDate));
    return {
      party_id: doc.partyId,
      party_name: doc.partyName || UNALLOCATED_PARTY,
      party_phone: doc.partyPhone,
      transaction_id: doc.voucherId,
      transaction_type: doc.voucherType,
      reference_number: doc.reference,
      invoice_date: doc.docDate,
      due_date: doc.dueDate,
      original_amount: r2(Math.abs(doc.amount)),
      outstanding: r2(outstanding),
      days_old: days,
      age_bucket: bucketFor(days),
    };
  };

  return [
    ...debits.filter((d) => d.open > EPS).map((d) => row(d.doc, d.open)),
    ...credits.filter((c) => c.left > EPS).map((c) => row(c.doc, -c.left)),
  ];
}

export function buildAgeing(docs: AgeingDoc[], asOfDate: string): { summary: AgeingPartySummary[]; totals: AgeingTotals } {
  const groups = new Map<string, AgeingDoc[]>();
  for (const d of docs) {
    const key = d.partyId ?? '__unallocated__';
    const list = groups.get(key);
    if (list) list.push(d);
    else groups.set(key, [d]);
  }

  const emptyTotals = (): AgeingTotals => ({
    age_0_30: 0, age_30_60: 0, age_60_90: 0, age_90_plus: 0, age_60_plus: 0, on_account: 0, total: 0,
  });

  const summary: AgeingPartySummary[] = [];
  for (const list of groups.values()) {
    const rows = allocateParty(list, asOfDate);
    if (rows.length === 0) continue;
    const s: AgeingPartySummary = {
      party_id: list[0].partyId,
      party_name: list[0].partyName || UNALLOCATED_PARTY,
      party_phone: list[0].partyPhone,
      transactions: rows.sort((a, b) => (a.invoice_date < b.invoice_date ? 1 : -1)),
      ...emptyTotals(),
    };
    for (const r of rows) {
      s.total += r.outstanding;
      if (r.outstanding < 0) s.on_account += r.outstanding;
      else if (r.age_bucket === '0-30') s.age_0_30 += r.outstanding;
      else if (r.age_bucket === '31-60') s.age_30_60 += r.outstanding;
      else if (r.age_bucket === '61-90') s.age_60_90 += r.outstanding;
      else s.age_90_plus += r.outstanding;
    }
    s.age_60_plus = s.age_60_90 + s.age_90_plus;
    for (const k of Object.keys(emptyTotals()) as Array<keyof AgeingTotals>) s[k] = r2(s[k]);
    if (Math.abs(s.total) > EPS || rows.length) summary.push(s);
  }

  summary.sort((a, b) => a.party_name.localeCompare(b.party_name));
  const totals = summary.reduce((acc, s) => {
    for (const k of Object.keys(acc) as Array<keyof AgeingTotals>) acc[k] = r2(acc[k] + s[k]);
    return acc;
  }, emptyTotals());
  return { summary, totals };
}
