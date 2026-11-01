import { presentLedgerEntries } from '@/lib/accounting/ledger-presentation';
import type { LedgerSourceLine } from '@/lib/accounting/ledger-presentation';

function line(partial: Partial<LedgerSourceLine> & Pick<LedgerSourceLine, 'id' | 'account_id'>): LedgerSourceLine {
  return {
    entry_date: '2026-10-24',
    account_nature: 'debit',
    debit: 0,
    credit: 0,
    ...partial,
  };
}

describe('ledger presentation', () => {
  test('a receivable invoice and its receipt on the same bill become one row', () => {
    const rows = presentLedgerEntries([
      line({
        id: 'sale',
        account_id: 'ar',
        account_code: '1103',
        account_name: 'Accounts Receivable',
        voucher_type: 'invoice',
        reference_number: 'INV-001',
        narration: 'Credit sale - Invoice INV-001',
        debit: 590,
        created_at: '2026-10-24T10:00:00',
      }),
      line({
        id: 'cash',
        account_id: 'cash',
        account_name: 'Cash',
        voucher_type: 'payment',
        reference_number: 'INV-001',
        narration: 'Receipt against Invoice INV-001',
        debit: 590,
        created_at: '2026-10-24T10:01:00',
      }),
      line({
        id: 'receipt',
        account_id: 'ar',
        account_code: '1103',
        account_name: 'Accounts Receivable',
        voucher_type: 'payment',
        reference_number: 'INV-001',
        narration: 'Receipt against Invoice INV-001',
        credit: 590,
        created_at: '2026-10-24T10:01:00',
      }),
    ]);

    const receivable = rows.find((row) => row.account_id === 'ar');
    expect(receivable).toMatchObject({
      debit: 590,
      credit: 590,
      opening: 0,
      opening_side: null,
      closing: 0,
      balance_side: null,
      reference_number: 'INV-001',
      voucher_types: ['invoice', 'payment'],
    });
    expect(receivable?.narration).toContain('Credit sale');
    expect(receivable?.narration).toContain('Receipt against');
    expect(rows.find((row) => row.account_id === 'cash')).toMatchObject({
      debit: 590,
      credit: 0,
      opening: 0,
      closing: 590,
      balance_side: 'Dr',
    });
  });

  test('a credit-nature account closes on the credit side', () => {
    const rows = presentLedgerEntries([
      line({
        id: 'gst',
        account_id: 'cgst',
        account_nature: 'credit',
        reference_number: 'INV-001',
        credit: 45,
      }),
    ]);
    expect(rows[0]).toMatchObject({ closing: 45, balance_side: 'Cr', opening: 0 });
  });

  test('brought-forward balance is the opening of the first row', () => {
    const rows = presentLedgerEntries(
      [line({ id: 'sale', account_id: 'cash', reference_number: 'INV-002', debit: 50 })],
      [{ account_id: 'cash', debit: 100, credit: 0 }],
    );
    expect(rows[0]).toMatchObject({
      opening: 100,
      opening_side: 'Dr',
      debit: 50,
      closing: 150,
      balance_side: 'Dr',
    });
  });

  test('another movement of the same account between the two sides keeps both rows', () => {
    const rows = presentLedgerEntries([
      line({ id: 'sale', account_id: 'ar', reference_number: 'INV-001', debit: 590, created_at: '2026-10-01' }),
      line({ id: 'other', account_id: 'ar', reference_number: 'INV-002', debit: 10, created_at: '2026-10-02' }),
      line({ id: 'receipt', account_id: 'ar', reference_number: 'INV-001', credit: 590, created_at: '2026-10-03' }),
    ]);
    expect(rows).toHaveLength(3);
    const receipt = rows.find((row) => row.id === 'receipt');
    expect(receipt).toMatchObject({ opening: 600, opening_side: 'Dr', credit: 590, closing: 10, balance_side: 'Dr' });
  });
});
