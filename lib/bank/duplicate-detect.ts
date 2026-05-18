import { extractReferencesFromDescription } from '@/lib/bank/reference-extract';

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function jaccardTokens(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter((x) => x.length > 1));
  const tb = new Set(norm(b).split(' ').filter((x) => x.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export type LineForDup = {
  id: string;
  transaction_date: string;
  debit_amount: number;
  credit_amount: number;
  description: string;
};

/**
 * O(n) bucketing by date+amounts, then pairwise check inside small buckets.
 */
export function computeDuplicateFlags(lines: LineForDup[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const l of lines) out.set(l.id, false);

  const bucket = new Map<string, LineForDup[]>();
  for (const l of lines) {
    const k = `${l.transaction_date}|${Math.round(l.debit_amount * 100)}|${Math.round(l.credit_amount * 100)}`;
    if (!bucket.has(k)) bucket.set(k, []);
    bucket.get(k)!.push(l);
  }

  for (const group of bucket.values()) {
    if (group.length < 2) continue;
    const refs = group.map((l) => extractReferencesFromDescription(l.description));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;
        const jac = jaccardTokens(a.description, b.description);
        const sharedLong = refs[i]!.long_numeric_refs.some((x) => refs[j]!.long_numeric_refs.includes(x));
        const similar = jac >= 0.45 || sharedLong;
        if (similar) {
          out.set(a.id, true);
          out.set(b.id, true);
        }
      }
    }
  }

  return out;
}
