jest.mock('@/lib/db', () => ({ getPool: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import type { PoolClient } from 'pg';
import { formatGstDate } from '@/lib/gst/gstr1';
import { toGstUqc } from '@/lib/gst/uqc';
import { formatDateForGSTN } from '@/lib/export/json';
import { purchaseOutstanding } from '@/lib/purchases/purchase-balance';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

function fakeClient(responses: Array<{ rows: any[] }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return responses.shift() ?? { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe('GST date formats', () => {
  it('formats DATE values as dd-mm-yyyy', () => {
    expect(formatGstDate(new Date(2026, 8, 7))).toBe('07-09-2026');
    expect(formatGstDate('2026-08-15')).toBe('15-08-2026');
    expect(formatGstDate(null)).toBe('');
  });

  it('normalises legacy d/m/yyyy strings for the JSON export', () => {
    expect(formatDateForGSTN('27/9/2026')).toBe('27-09-2026');
    expect(formatDateForGSTN('07-09-2026')).toBe('07-09-2026');
    expect(formatDateForGSTN('2026-09-27')).toBe('27-09-2026');
  });
});

describe('toGstUqc', () => {
  it('maps common units to GSTN codes', () => {
    expect(toGstUqc('KG')).toBe('KGS');
    expect(toGstUqc('kg.')).toBe('KGS');
    expect(toGstUqc('Pcs')).toBe('PCS');
    expect(toGstUqc('litre')).toBe('LTR');
    expect(toGstUqc('NOS')).toBe('NOS');
  });

  it('reports services as NA and unknown units as OTH', () => {
    expect(toGstUqc('hours', '998314')).toBe('NA');
    expect(toGstUqc('bundle-x')).toBe('OTH');
    expect(toGstUqc('')).toBe('OTH');
  });
});

describe('purchaseOutstanding', () => {
  it('excludes reverse-charge GST from what the supplier is owed', () => {
    expect(
      purchaseOutstanding({ grand_total: 1180, tax_total: 180, is_reverse_charge: true, paid_amount: 0 })
    ).toBe(1000);
  });

  it('deducts cash paid and TDS', () => {
    expect(
      purchaseOutstanding({ grand_total: 70800, tax_total: 10800, is_reverse_charge: false, paid_amount: 50000, tds_deducted: 6000 })
    ).toBe(14800);
    expect(
      purchaseOutstanding({ grand_total: 1000, tax_total: 0, is_reverse_charge: false, paid_amount: 1200 })
    ).toBe(0);
  });
});

describe('recomputeInvoiceBalance', () => {
  it('nets active debit and credit notes against receipts', async () => {
    const { client, calls } = fakeClient([
      { rows: [{ grand_total: '11800', paid_amount: '11800', status: 'final', debited: '118', credited: '0' }] },
      { rows: [] },
    ]);
    const res = await recomputeInvoiceBalance(client, 'inv', 'biz');
    expect(res).toMatchObject({ balance_amount: 118, payment_status: 'partially_paid' });
    expect(calls[1].params).toEqual([118, 'partially_paid', 'inv', 'biz']);
  });

  it('never goes negative when credit exceeds what is due', async () => {
    const { client } = fakeClient([
      { rows: [{ grand_total: '5000', paid_amount: '5000', status: 'final', debited: '0', credited: '1000' }] },
      { rows: [] },
    ]);
    const res = await recomputeInvoiceBalance(client, 'inv', 'biz');
    expect(res?.balance_amount).toBe(0);
    expect(res?.payment_status).toBe('paid');
  });

  it('reports zero balance for a cancelled invoice without writing', async () => {
    const { client, calls } = fakeClient([
      { rows: [{ grand_total: '5000', paid_amount: '0', status: 'cancelled', debited: '0', credited: '0' }] },
    ]);
    const res = await recomputeInvoiceBalance(client, 'inv', 'biz');
    expect(res?.balance_amount).toBe(0);
    expect(calls).toHaveLength(1);
  });
});

describe('reverseVoucherLedgerEntries', () => {
  const lines = [
    { id: 'l1', account_id: 'ar', entry_date: '2026-09-10', debit: '11800', credit: '0', narration: 'Sale', reference_number: 'INV-1', branch_id: 'b' },
    { id: 'l2', account_id: 'sales', entry_date: '2026-09-10', debit: '0', credit: '10000', narration: 'Sale', reference_number: 'INV-1', branch_id: 'b' },
    { id: 'l3', account_id: 'gst', entry_date: '2026-09-10', debit: '0', credit: '1800', narration: 'Sale', reference_number: 'INV-1', branch_id: 'b' },
  ];

  it('posts mirrored lines and links each to its original', async () => {
    const { client, calls } = fakeClient([
      { rows: lines },
      { rows: [{ id: 'r1' }] }, { rows: [] },
      { rows: [{ id: 'r2' }] }, { rows: [] },
      { rows: [{ id: 'r3' }] }, { rows: [] },
    ]);
    const n = await reverseVoucherLedgerEntries(client, {
      businessId: 'biz', voucherType: 'invoice', voucherId: 'inv', reason: 'Invoice cancelled',
    });
    expect(n).toBe(3);
    expect(calls[0].sql).toMatch(/ledger_entry_reversals/);
    const inserts = calls.filter((c) => /INSERT INTO ledger_entry_lines/.test(c.sql)).map((c) => c.params);
    const links = calls.filter((c) => /INSERT INTO ledger_entry_reversals/.test(c.sql)).map((c) => c.params);
    expect(inserts).toHaveLength(3);
    const debit = inserts.reduce((s, p) => s + Number(p[5]), 0);
    const credit = inserts.reduce((s, p) => s + Number(p[6]), 0);
    expect(debit).toBe(11800);
    expect(credit).toBe(11800);
    expect(inserts[0][5]).toBe(0);
    expect(inserts[0][6]).toBe(11800);
    expect(String(inserts[0][7])).toMatch(/^Reversal:/);
    expect(links.map((p) => [p[0], p[1]])).toEqual([['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']]);
  });

  it('does nothing when the voucher has no unreversed lines', async () => {
    const { client, calls } = fakeClient([{ rows: [] }]);
    const n = await reverseVoucherLedgerEntries(client, {
      businessId: 'biz', voucherType: 'invoice', voucherId: 'inv', reason: 'again',
    });
    expect(n).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
