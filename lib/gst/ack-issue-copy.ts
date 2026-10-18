import type { AckIssue } from '@/lib/gst/acknowledgements';

export interface AckIssueCopy {
  title: string;
  detail: string;
}

const HEAD_LABEL: Record<string, string> = {
  igst: 'IGST',
  cgst: 'CGST',
  sgst: 'SGST',
  cess: 'Cess',
};

function rupee(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(value);
}

function periodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month >= 1 && month <= 12) {
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }
  return period;
}

function headDifferenceCopy(issue: AckIssue): AckIssueCopy {
  const head = HEAD_LABEL[String(issue.facts.head || '')] || 'Tax';
  const gstr1 = issue.facts.gstr1;
  const books = issue.facts.books;
  if (typeof gstr1 === 'number' && typeof books === 'number') {
    const gap = Math.abs(gstr1 - books);
    const higher = gstr1 > books ? 'GSTR-1 is higher than the books' : 'the books are higher than GSTR-1';
    return {
      title: `${head} does not match`,
      detail: `${head} is ${rupee(gstr1)} on GSTR-1 and ${rupee(books)} on the books. ${higher} by ${rupee(gap)}.`,
    };
  }
  const amount = Math.abs(issue.amounts.igst || issue.amounts.cgst || issue.amounts.sgst || issue.amounts.cess || 0);
  return {
    title: `${head} does not match`,
    detail: amount > 0
      ? `${head} differs by ${rupee(amount)} between GSTR-1 and the books.`
      : `${head} on GSTR-1 does not match the books.`,
  };
}

export function describeAckIssue(issue: AckIssue): AckIssueCopy {
  if (String(issue.key).startsWith('period:')) {
    const state = String(issue.facts.state || '');
    const label = periodLabel(String(issue.facts.periodKey || ''));
    if (state === 'stale') {
      return { title: 'Figures changed', detail: `${label} changed after it was last reconciled.` };
    }
    if (state === 'awaiting_gstr2b') {
      return { title: 'GSTR-2B is missing', detail: `${label} is still waiting for the GSTR-2B file from the portal.` };
    }
    return { title: 'Not reconciled yet', detail: `${label} has not been reconciled yet.` };
  }

  const reason = issue.facts.reason;
  if (reason === 'no_branch') {
    return {
      title: 'No branch to compare',
      detail: 'This business has no active branch, so GSTR-1 could not be compared with the books.',
    };
  }
  if (reason === 'comparison_failed') {
    const label = periodLabel(String(issue.facts.period || ''));
    return {
      title: 'Comparison failed',
      detail: `GSTR-1 could not be compared with the books for ${label}.`,
    };
  }
  if (issue.facts.kind === 'head_difference' || String(issue.key).startsWith('head:')) {
    return headDifferenceCopy(issue);
  }

  return {
    title: 'Needs review',
    detail: 'This return has a review item that has not been acknowledged.',
  };
}

export function reviewHeading(count: number): string {
  if (count === 1) return '1 item needs review before the file is generated.';
  return `${count} items need review before the file is generated.`;
}
