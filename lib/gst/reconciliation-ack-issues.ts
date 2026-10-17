/**
 * Turns the existing GSTR-1 versus books (GSTR-3B ledger) head comparison into
 * acknowledgement issues. A difference within ₹1 is rounding and is not an issue.
 */

import { aboveRounding, type AckIssue, type TaxHeads } from '@/lib/gst/acknowledgements';

export interface HeadCompare {
  gstr1: number;
  gstr3b: number;
  difference: number;
}

export interface HeadWiseComparison {
  igst: HeadCompare;
  cgst: HeadCompare;
  sgst: HeadCompare;
  cess: HeadCompare;
}

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

const zero = (): TaxHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });

export function issuesFromHeadComparison(input: {
  period: string;
  branchId: string;
  headWise: HeadWiseComparison;
}): AckIssue[] {
  const issues: AckIssue[] = [];
  for (const head of HEADS) {
    const compared = input.headWise[head];
    const amounts = zero();
    amounts[head] = compared.difference;
    if (!aboveRounding(amounts)) continue;
    issues.push({
      key: `head:${input.period}:${input.branchId}:${head}`,
      facts: {
        kind: 'head_difference',
        period: input.period,
        branchId: input.branchId,
        head,
        gstr1: compared.gstr1,
        books: compared.gstr3b,
      },
      amounts,
    });
  }
  return issues;
}

export function periodsForReturn(kind: 'gstr1' | 'gstr3b' | 'gstr9', periodKey: string): string[] {
  if (kind !== 'gstr9') return /^\d{4}-\d{2}$/.test(periodKey) ? [periodKey] : [];
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!match) return [];
  const start = Number(match[1]);
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const month = ((4 + i - 1) % 12) + 1;
    const year = month >= 4 ? start : start + 1;
    months.push(`${year}-${String(month).padStart(2, '0')}`);
  }
  return months;
}

export async function collectHeadDifferenceIssues(input: {
  kind: 'gstr1' | 'gstr3b' | 'gstr9';
  periodKey: string;
  branches: string[];
  run: (period: string, branchId: string) => Promise<HeadWiseComparison>;
}): Promise<AckIssue[]> {
  if (input.branches.length === 0) {
    return [
      {
        key: `recon:${input.periodKey}:no-branch`,
        facts: { kind: 'head_difference', reason: 'no_branch', period: input.periodKey },
        amounts: zero(),
      },
    ];
  }
  const issues: AckIssue[] = [];
  for (const period of periodsForReturn(input.kind, input.periodKey)) {
    for (const branchId of input.branches) {
      try {
        const headWise = await input.run(period, branchId);
        issues.push(...issuesFromHeadComparison({ period, branchId, headWise }));
      } catch {
        issues.push({
          key: `recon:${period}:${branchId}:failed`,
          facts: { kind: 'head_difference', reason: 'comparison_failed', period, branchId },
          amounts: zero(),
        });
      }
    }
  }
  return issues;
}
