jest.mock('@/lib/db', () => ({ getPool: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import type { PoolClient } from 'pg';
import {
  daysBetween,
  rule37Interest,
  rule37Status,
  rule37TargetReversal,
  syncRule37ForBill,
  type Rule37Row,
} from '@/lib/gst/rule37';

const itc = { igst: 0, cgst: 900, sgst: 900, cess: 0 };

describe('Rule 37 — 180-day unpaid supplier bills (Run 11 L9)', () => {
  it('status windows', () => {
    expect(daysBetween('2026-01-01', '2026-06-30')).toBe(180);
    expect(rule37Status('2026-01-01', '2026-05-30')).toBe('within');
    expect(rule37Status('2026-01-01', '2026-05-31')).toBe('approaching');
    expect(rule37Status('2026-01-01', '2026-06-30')).toBe('approaching');
    expect(rule37Status('2026-01-01', '2026-07-01')).toBe('overdue');
    expect(rule37Status('2026-01-01', '2026-03-01')).toBe('within');
  });

  it('no reversal until day 181', () => {
    const t = rule37TargetReversal({ itc, grandTotal: 11800, unpaid: 11800, billDate: '2026-01-01', asOn: '2026-06-30' });
    expect(t).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  it('fully unpaid after 180 days: full ITC reversed', () => {
    const t = rule37TargetReversal({ itc, grandTotal: 11800, unpaid: 11800, billDate: '2026-01-01', asOn: '2026-07-01' });
    expect(t).toEqual({ igst: 0, cgst: 900, sgst: 900, cess: 0 });
  });

  it('partly paid: reversal proportional to unpaid value', () => {
    const t = rule37TargetReversal({ itc, grandTotal: 11800, unpaid: 5900, billDate: '2026-01-01', asOn: '2026-07-01' });
    expect(t.cgst).toBe(450);
    expect(t.sgst).toBe(450);
  });

  it('paid in full later: target falls to zero (re-availment)', () => {
    const t = rule37TargetReversal({ itc, grandTotal: 11800, unpaid: 0, billDate: '2026-01-01', asOn: '2026-09-01' });
    expect(t.cgst + t.sgst).toBe(0);
  });

  it('interest @18% p.a. is computed for reporting', () => {
    expect(rule37Interest(1800, '2026-01-01', '2026-07-01')).toBe(round(1800 * 0.18 * 181 / 365));
  });
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function fakeClient() {
  const inserted: Array<{ voucherType: string; account: string; debit: number; credit: number; ref: string }> = [];
  const client = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/SELECT id FROM accounts/.test(sql)) return { rows: [{ id: `acc-${params[1]}` }] };
      if (/INSERT INTO ledger_entry_lines/.test(sql)) {
        inserted.push({
          voucherType: String(params[2]),
          account: String(params[3]).replace('acc-', ''),
          debit: Number(params[5]),
          credit: Number(params[6]),
          ref: String(params[8]),
        });
      }
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, inserted };
}

const row = (over: Partial<Rule37Row>): Rule37Row => ({
  purchase_id: 'p1',
  bill_number: 'B-1',
  bill_date: '2026-01-01',
  supplier_id: 's1',
  branch_id: 'br1',
  days_outstanding: 181,
  status: 'overdue',
  grand_total: 11800,
  unpaid: 11800,
  itc_claimed: itc,
  target_reversal: { igst: 0, cgst: 900, sgst: 900, cess: 0 },
  already_reversed: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
  interest_if_utilised: 0,
  ...over,
});

describe('syncRule37ForBill — vouchers', () => {
  it('posts a balanced reversal: Dr ITC Suspense, Cr Input CGST/SGST, tagged to the bill', async () => {
    const f = fakeClient();
    const r = await syncRule37ForBill(f.client, { businessId: 'biz', row: row({}), entryDate: '2026-07-01' });
    expect(r).toEqual({ reversed: 1800, reavailed: 0 });
    expect(f.inserted.every((l) => l.voucherType === 'itc_reversal_r37' && l.ref === 'RULE37|p1')).toBe(true);
    expect(f.inserted.find((l) => l.account === '1114')?.debit).toBe(1800);
    expect(f.inserted.filter((l) => ['1110', '1111'].includes(l.account)).reduce((s, l) => s + l.credit, 0)).toBe(1800);
  });

  it('re-avails on payment: Dr Input, Cr ITC Suspense', async () => {
    const f = fakeClient();
    const r = await syncRule37ForBill(f.client, {
      businessId: 'biz',
      row: row({ unpaid: 0, target_reversal: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, already_reversed: { igst: 0, cgst: 900, sgst: 900, cess: 0 } }),
      entryDate: '2026-09-01',
    });
    expect(r).toEqual({ reversed: 0, reavailed: 1800 });
    expect(f.inserted.every((l) => l.voucherType === 'itc_reavail_r37')).toBe(true);
    expect(f.inserted.find((l) => l.account === '1114')?.credit).toBe(1800);
  });

  it('is idempotent: nothing posted when the position already matches', async () => {
    const f = fakeClient();
    const r = await syncRule37ForBill(f.client, {
      businessId: 'biz',
      row: row({ already_reversed: { igst: 0, cgst: 900, sgst: 900, cess: 0 } }),
      entryDate: '2026-07-15',
    });
    expect(r).toEqual({ reversed: 0, reavailed: 0 });
    expect(f.inserted).toHaveLength(0);
  });
});
