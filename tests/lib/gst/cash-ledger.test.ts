jest.mock('@/lib/db', () => {
  const state = {
    balance: '0',
    deposits: [] as { account_id: string; account_code: string; debit: string }[],
    lines: [] as Record<string, string | null>[],
  };
  const client = {
    query: jest.fn(async (sql: string) => {
      const text = String(sql);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('get_account_balance')) return { rows: [{ b: state.balance }] };
      if (text.includes('SUM(lel.debit)')) return { rows: state.deposits };
      if (text.includes('FROM ledger_entry_lines')) return { rows: state.lines };
      if (text.includes('FROM accounts')) return { rows: [{ ok: 1 }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  return {
    getPool: () => ({ connect: async () => client, query: client.query }),
    queryOne: jest.fn(),
    queryRows: jest.fn(),
    __state: state,
    __client: client,
  };
});

jest.mock('@/lib/ledger-utils', () => ({
  getAccountByCode: jest.fn(async (_businessId: string, code: string) => ({ id: `id-${code}`, account_code: code })),
  createLedgerEntryLine: jest.fn(async () => 'line'),
}));

jest.mock('@/lib/ledger-reversal', () => ({
  activeLedgerLineSql: () => 'TRUE',
  reverseVoucherLedgerEntries: jest.fn(async () => 2),
}));

import { createLedgerEntryLine } from '@/lib/ledger-utils';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import {
  GST_CASH_DISCHARGE_VOUCHER_TYPES,
  POOLED_RCM_CASH_LEDGER_CODE,
  getGstPaymentEvents,
  recordGstCashDeposit,
  recordGstCashUtilization,
  recordGstPayment,
  resolveGstCashLedgerPosting,
  reverseGstCashLedgerVoucher,
} from '@/lib/gst/gst-settlement';

const db = jest.requireMock('@/lib/db') as {
  __state: {
    balance: string;
    deposits: { account_id: string; account_code: string; debit: string }[];
    lines: Record<string, string | null>[];
  };
  __client: { query: jest.Mock; release: jest.Mock };
};

const lines = () => (createLedgerEntryLine as jest.Mock).mock.calls.map((c) => c[0]);

beforeEach(() => {
  db.__state.balance = '0';
  db.__state.deposits = [];
  db.__state.lines = [];
  db.__client.query.mockClear();
  (createLedgerEntryLine as jest.Mock).mockClear();
  (reverseVoucherLedgerEntries as jest.Mock).mockClear();
});

describe('resolveGstCashLedgerPosting', () => {
  it('pays pooled RCM 2155 from IGST cash 1130 when no cash head is named', () => {
    const posting = resolveGstCashLedgerPosting('RCM');
    expect(posting.liabilityCode).toBe('2155');
    expect(posting.cashCode).toBe(POOLED_RCM_CASH_LEDGER_CODE);
    expect(posting.cashCode).toBe('1130');
  });

  it('pays pooled RCM 2155 from the named CGST or SGST cash head, never cess', () => {
    expect(resolveGstCashLedgerPosting('RCM', 'CGST').cashCode).toBe('1131');
    expect(resolveGstCashLedgerPosting('RCM', 'SGST').cashCode).toBe('1132');
    expect(() => resolveGstCashLedgerPosting('RCM', 'CESS')).toThrow(/1133/);
  });

  it('maps split RCM onto the matching cash head and liability', () => {
    expect(resolveGstCashLedgerPosting('RCM_IGST')).toEqual({ cashCode: '1130', liabilityCode: '2158', cashHead: 'IGST' });
    expect(resolveGstCashLedgerPosting('RCM_CGST')).toEqual({ cashCode: '1131', liabilityCode: '2156', cashHead: 'CGST' });
    expect(resolveGstCashLedgerPosting('RCM_SGST')).toEqual({ cashCode: '1132', liabilityCode: '2157', cashHead: 'SGST' });
  });
});

describe('electronic cash ledger postings', () => {
  const base = { businessId: 'b1', branchId: 'br1', paymentDate: '2026-04-20', amount: 100 };

  it('deposits into the cash ledger and the bank without touching GST liability', async () => {
    const result = await recordGstCashDeposit({ ...base, taxHead: 'IGST', challanNumber: 'CH-1' });
    const posted = lines();
    expect(posted).toHaveLength(2);
    expect(posted.every((l) => l.voucherType === 'gst_cash_deposit')).toBe(true);
    expect(posted[0]).toMatchObject({ accountId: 'id-1130', debit: 100, credit: 0 });
    expect(posted[1]).toMatchObject({ accountId: 'id-1102', debit: 0, credit: 100 });
    expect(posted.some((l) => String(l.accountId).includes('215'))).toBe(false);
    expect(result.cash_account_code).toBe('1130');
    expect(result.reference_number).toBe('GST_CASH_DEP|CH-1|IGST');
  });

  it('utilises only up to the cash-ledger balance and reduces liability', async () => {
    db.__state.balance = '40';
    await expect(recordGstCashUtilization({ ...base, taxHead: 'CGST', amount: 50 })).rejects.toThrow(/Insufficient/);
    expect(createLedgerEntryLine).not.toHaveBeenCalled();

    db.__state.balance = '80';
    const result = await recordGstCashUtilization({ ...base, taxHead: 'CGST', amount: 30 });
    const posted = lines();
    expect(posted[0]).toMatchObject({ voucherType: 'gst_cash_utilization', accountId: 'id-2150', debit: 30, credit: 0 });
    expect(posted[1]).toMatchObject({ voucherType: 'gst_cash_utilization', accountId: 'id-1131', debit: 0, credit: 30 });
    expect(result.liability_account_code).toBe('2150');
  });

  it('rejects reversing a deposit that utilisation still depends on, then allows it once the balance covers the deposit', async () => {
    db.__state.deposits = [{ account_id: 'id-1130', account_code: '1130', debit: '100' }];
    db.__state.balance = '20';
    await expect(
      reverseGstCashLedgerVoucher({
        businessId: 'b1',
        branchId: 'br1',
        voucherId: 'dep-1',
        voucherType: 'gst_cash_deposit',
        reason: 'wrong challan',
      })
    ).rejects.toThrow(/utilisation/);
    expect(reverseVoucherLedgerEntries).not.toHaveBeenCalled();

    db.__state.balance = '100';
    const ok = await reverseGstCashLedgerVoucher({
      businessId: 'b1',
      branchId: 'br1',
      voucherId: 'dep-1',
      voucherType: 'gst_cash_deposit',
      reason: 'wrong challan',
    });
    expect(ok.reversed_lines).toBe(2);
    expect(reverseVoucherLedgerEntries).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ voucherType: 'gst_cash_deposit', voucherId: 'dep-1' })
    );
  });

  it('posts a one-shot payment as a deposit and a utilisation, including pooled RCM on 1130', async () => {
    db.__state.balance = '100';
    const result = await recordGstPayment({ ...base, taxHead: 'RCM', challanNumber: 'PMT-9' });
    const posted = lines();
    expect(posted.map((l) => l.voucherType)).toEqual([
      'gst_cash_deposit',
      'gst_cash_deposit',
      'gst_cash_utilization',
      'gst_cash_utilization',
    ]);
    expect(posted[0]).toMatchObject({ accountId: 'id-1130', debit: 100 });
    expect(posted[1]).toMatchObject({ accountId: 'id-1102', credit: 100 });
    expect(posted[2]).toMatchObject({ accountId: 'id-2155', debit: 100 });
    expect(posted[3]).toMatchObject({ accountId: 'id-1130', credit: 100 });
    expect(posted[0].voucherId).toBe(posted[1].voucherId);
    expect(posted[2].voucherId).toBe(posted[3].voucherId);
    expect(posted[0].voucherId).not.toBe(posted[2].voucherId);
    expect(result.voucherId).toBe(posted[2].voucherId);
    expect(result.deposit_voucher_id).toBe(posted[0].voucherId);
    expect(result.challan_details.cash_account_code).toBe('1130');
    expect(result.challan_details.tax_head).toBe('RCM');

    (createLedgerEntryLine as jest.Mock).mockClear();
    await recordGstPayment({ ...base, taxHead: 'RCM', cashHead: 'SGST' });
    expect(lines()[0].accountId).toBe('id-1132');
    expect(lines()[2].accountId).toBe('id-2155');
    expect(lines()[3].accountId).toBe('id-1132');
  });

  it('counts gst_payment and gst_cash_utilization as tax paid, and not deposits', async () => {
    expect(GST_CASH_DISCHARGE_VOUCHER_TYPES).toEqual(['gst_payment', 'gst_cash_utilization']);
    await getGstPaymentEvents({
      businessId: 'b1',
      branchId: 'br1',
      afterDateExclusive: '2026-04-01',
      uptoDate: '2026-04-30',
    });
    const call = db.__client.query.mock.calls.find((c) => String(c[0]).includes('voucher_type'));
    expect(call[1][5]).toEqual(['gst_payment', 'gst_cash_utilization']);
    expect(call[1][5]).not.toContain('gst_cash_deposit');
  });
});
