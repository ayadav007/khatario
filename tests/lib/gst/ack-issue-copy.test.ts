import { describeAckIssue, reviewHeading } from '@/lib/gst/ack-issue-copy';
import type { AckIssue } from '@/lib/gst/acknowledgements';

const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };

function issue(partial: Partial<AckIssue> & Pick<AckIssue, 'key'>): AckIssue {
  return { facts: {}, amounts: zero, ...partial };
}

describe('return review copy', () => {
  it('uses needs for one item and need for many', () => {
    expect(reviewHeading(1)).toBe('1 item needs review before the file is generated.');
    expect(reviewHeading(2)).toBe('2 items need review before the file is generated.');
  });

  it('names an unreconciled period', () => {
    const copy = describeAckIssue(issue({
      key: 'period:gstr1:2026-09:not_checked',
      facts: { kind: 'gstr1', periodKey: '2026-09', state: 'not_checked' },
    }));
    expect(copy.title).toBe('Not reconciled yet');
    expect(copy.detail).toBe('September 2026 has not been reconciled yet.');
  });

  it('names the tax head and both amounts', () => {
    const copy = describeAckIssue(issue({
      key: 'head:2026-09:branch:igst',
      facts: { kind: 'head_difference', head: 'igst', gstr1: 948.95, books: 500 },
      amounts: { igst: 448.95, cgst: 0, sgst: 0, cess: 0 },
    }));
    expect(copy.title).toBe('IGST does not match');
    expect(copy.detail).toContain('₹948.95');
    expect(copy.detail).toContain('₹500.00');
    expect(copy.detail).toContain('GSTR-1 is higher than the books');
  });

  it('says when the books are higher', () => {
    const copy = describeAckIssue(issue({
      key: 'head:2026-09:branch:cgst',
      facts: { kind: 'head_difference', head: 'cgst', gstr1: 100, books: 250 },
    }));
    expect(copy.detail).toContain('the books are higher than GSTR-1');
  });
});