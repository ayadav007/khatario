import { runBankReconciliationEngine } from '@/lib/bank/reconciliation-engine';

describe('runBankReconciliationEngine', () => {
  it('suggests a match from a statement credit to a ledger debit and does not post', () => {
    const result = runBankReconciliationEngine({
      bankLines: [
        {
          id: 'stmt-1',
          transaction_date: '2026-04-02',
          description: 'NEFT HDFC',
          debit_amount: 0,
          credit_amount: 1500,
        },
      ],
      ledgerLines: [
        {
          id: 'led-1',
          entry_date: '2026-04-02',
          debit: 1500,
          credit: 0,
          narration: 'Receipt',
          reference_number: null,
        },
      ],
    });

    expect(result.suggestions).toEqual([
      expect.objectContaining({
        bankLineId: 'stmt-1',
        ledgerLineIds: ['led-1'],
        tier: 'exact',
      }),
    ]);
    expect(result).not.toHaveProperty('vouchers');
    expect(JSON.stringify(result)).not.toMatch(/insert|voucher_type/i);
  });

  it('does not match a statement credit to a credit on the bank ledger', () => {
    const result = runBankReconciliationEngine({
      bankLines: [
        {
          id: 'stmt-1',
          transaction_date: '2026-04-02',
          description: 'Deposit',
          debit_amount: 0,
          credit_amount: 1500,
        },
      ],
      ledgerLines: [
        {
          id: 'led-1',
          entry_date: '2026-04-02',
          debit: 0,
          credit: 1500,
          narration: 'Wrong side',
          reference_number: null,
        },
      ],
    });
    expect(result.suggestions).toEqual([]);
    expect(result.unmatchedBankIds).toContain('stmt-1');
  });
});
