import { buildContraLines, type CashBankAccount } from '@/lib/accounting/contra';

const accounts: CashBankAccount[] = [
  { id: 'cash', code: '1101', name: 'Cash in Hand', kind: 'cash' },
  { id: 'petty', code: '1109', name: 'Petty Cash', kind: 'cash' },
  { id: 'hdfc', code: '1102', name: 'HDFC Current', kind: 'bank' },
  { id: 'sbi', code: '1110', name: 'SBI Current', kind: 'bank' },
];

describe('buildContraLines', () => {
  it('cash deposit debits bank and credits cash', () => {
    const r = buildContraLines({ fromAccountId: 'cash', toAccountId: 'hdfc', amount: 5000 }, accounts);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('cash_deposit');
    expect(r.lines).toEqual([
      expect.objectContaining({ accountId: 'hdfc', debit: 5000, credit: 0 }),
      expect.objectContaining({ accountId: 'cash', debit: 0, credit: 5000 }),
    ]);
  });

  it('cash withdrawal debits cash and credits bank', () => {
    const r = buildContraLines({ fromAccountId: 'sbi', toAccountId: 'cash', amount: 1200.456 }, accounts);
    expect(r.ok && r.kind).toBe('cash_withdrawal');
    if (!r.ok) return;
    expect(r.lines[0]).toMatchObject({ accountId: 'cash', debit: 1200.46 });
  });

  it('bank to bank transfer', () => {
    const r = buildContraLines({ fromAccountId: 'hdfc', toAccountId: 'sbi', amount: 10 }, accounts);
    expect(r.ok && r.kind).toBe('bank_transfer');
  });

  it('rejects non cash/bank accounts, same account, cash-to-cash and bad amounts', () => {
    expect(buildContraLines({ fromAccountId: 'hdfc', toAccountId: 'sales', amount: 1 }, accounts)).toMatchObject({
      ok: false,
      code: 'NOT_CASH_OR_BANK',
    });
    expect(buildContraLines({ fromAccountId: 'hdfc', toAccountId: 'hdfc', amount: 1 }, accounts)).toMatchObject({
      code: 'SAME_ACCOUNT',
    });
    expect(buildContraLines({ fromAccountId: 'cash', toAccountId: 'petty', amount: 1 }, accounts)).toMatchObject({
      code: 'CASH_TO_CASH',
    });
    expect(buildContraLines({ fromAccountId: 'cash', toAccountId: 'hdfc', amount: 0 }, accounts)).toMatchObject({
      code: 'INVALID_AMOUNT',
    });
  });
});
