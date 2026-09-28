import { validateJournalLines } from '@/lib/accounting/journal-lines';
import { formatJournalNumber, journalYear } from '@/lib/accounting/journal-number';

describe('validateJournalLines', () => {
  const a = '00000000-0000-0000-0000-00000000000a';
  const b = '00000000-0000-0000-0000-00000000000b';

  it('accepts a balanced two-line voucher', () => {
    expect(
      validateJournalLines([
        { account_id: a, debit: 1000, credit: 0 },
        { account_id: b, debit: 0, credit: '1000.00' },
      ])
    ).toBeNull();
  });

  it('rejects unbalanced lines', () => {
    expect(
      validateJournalLines([
        { account_id: a, debit: 1000 },
        { account_id: b, credit: 900 },
      ])
    ).toMatch(/must be equal/);
  });

  it('rejects a line with both sides, no amount, negative or missing account', () => {
    expect(validateJournalLines([{ account_id: a, debit: 1, credit: 1 }, { account_id: b, credit: 0 }])).toMatch(/not both/);
    expect(validateJournalLines([{ account_id: a }, { account_id: b, credit: 1 }])).toMatch(/either debit or credit/);
    expect(validateJournalLines([{ account_id: a, debit: -5 }, { account_id: b, credit: -5 }])).toMatch(/non-negative/);
    expect(validateJournalLines([{ debit: 5 }, { account_id: b, credit: 5 }])).toMatch(/account_id/);
  });

  it('needs at least two lines', () => {
    expect(validateJournalLines([{ account_id: a, debit: 5 }])).toMatch(/At least 2/);
  });
});

describe('journal numbering', () => {
  it('formats JRN/YYYY/nnnnnn', () => {
    expect(formatJournalNumber('2026', 3)).toBe('JRN/2026/000003');
    expect(journalYear('2026-09-27')).toBe('2026');
  });
});
