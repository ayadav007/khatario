jest.mock('@/lib/db', () => ({ getPool: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import { buildItcTable4, itcLedgerMovements } from '@/lib/gst/gstr3b-itc';
import type { TaxBreakdown } from '@/lib/gst/gstr3b';

const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
const tax = (t: Partial<TaxBreakdown> = {}): TaxBreakdown => ({ taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, ...t });

const table4 = (o: {
  books: typeof zero;
  rows?: Array<{ voucher_type: string; account_code: string; amt: number }>;
  blocked?: TaxBreakdown;
  held?: typeof zero;
}) =>
  buildItcTable4({
    books: o.books,
    imports: tax(),
    import_services: tax(),
    inward_reverse_charge: tax(),
    blocked: o.blocked ?? tax(),
    movements: itcLedgerMovements(o.rows ?? []),
    held: o.held ?? zero,
    released: zero,
  });

describe('GSTR-3B Table 4: 4B(1) / 4B(2) / 4D(1) (Circular 170/02/2022)', () => {
  test('ledger nets are sorted by voucher type; re-availment debits come out positive', () => {
    const m = itcLedgerMovements([
      { voucher_type: 'itc_reversal', account_code: '1110', amt: 90 },
      { voucher_type: 'itc_reversal_r37', account_code: '1110', amt: 450 },
      { voucher_type: 'itc_reversal_r37', account_code: '1113', amt: 20 },
      { voucher_type: 'itc_reavail_r37', account_code: '1112', amt: -300 },
      { voucher_type: 'itc_reversal_r37', account_code: '1114', amt: -450 },
    ]);
    expect(m.rules).toEqual({ igst: 0, cgst: 90, sgst: 0, cess: 0 });
    expect(m.others).toEqual({ igst: 0, cgst: 450, sgst: 0, cess: 20 });
    expect(m.reclaimed).toEqual({ igst: 300, cgst: 0, sgst: 0, cess: 0 });
  });

  test('a Rule 37 reversal is in 4B(2), not 4B(1); 4A(5) stays gross and 4C nets it off', () => {
    // Books: 1,000 CGST availed this month, 450 of it reversed under Rule 37.
    const t = table4({ books: { ...zero, cgst: 550 }, rows: [{ voucher_type: 'itc_reversal_r37', account_code: '1110', amt: 450 }] });
    expect(t.other_itc.cgst).toBe(1000);
    expect(t.itc_reversed_others.cgst).toBe(450);
    expect(t.itc_reversed_rules.cgst).toBe(0);
    expect(t.itc_reversed.cgst).toBe(450);
    expect(t.net_itc.cgst).toBe(550);
    expect(t.itc_reclaimed.cgst).toBe(0);
  });

  test('s.17(5) blocked credit and stock-loss reversals stay in 4B(1)', () => {
    const t = table4({
      books: { ...zero, cgst: 910 },
      blocked: tax({ cgst: 180 }),
      rows: [{ voucher_type: 'itc_reversal', account_code: '1110', amt: 90 }],
    });
    expect(t.itc_reversed_rules.cgst).toBe(270);
    expect(t.itc_reversed_others.cgst).toBe(0);
    expect(t.other_itc.cgst).toBe(1180);
    expect(t.net_itc.cgst).toBe(910);
  });

  test('credit re-claimed on payment is in 4A(5) through the ledger and also shown in 4D(1)', () => {
    const t = table4({ books: { ...zero, sgst: 450 }, rows: [{ voucher_type: 'itc_reavail_r37', account_code: '1111', amt: -450 }] });
    expect(t.other_itc.sgst).toBe(450);
    expect(t.itc_reclaimed.sgst).toBe(450);
    expect(t.itc_reversed.sgst).toBe(0);
    expect(t.net_itc.sgst).toBe(450);
  });

  test('a Rule 37 cess reversal is in 4B(2) and 4C cess is unchanged by the split', () => {
    const t = table4({ books: { ...zero, cess: 80 }, rows: [{ voucher_type: 'itc_reversal_r37', account_code: '1113', amt: 20 }] });
    expect(t.other_itc.cess).toBe(100);
    expect(t.itc_reversed_others.cess).toBe(20);
    expect(t.net_itc.cess).toBe(80);
  });

  test('4C equals the books net ITC less what GSTR-2B holds back, whatever the reversal mix', () => {
    const t = table4({
      books: { igst: 300, cgst: 700, sgst: 700, cess: 0 },
      held: { ...zero, cgst: 100, sgst: 100 },
      blocked: tax({ cgst: 50, sgst: 50 }),
      rows: [
        { voucher_type: 'itc_reversal', account_code: '1110', amt: 30 },
        { voucher_type: 'itc_reversal_r37', account_code: '1110', amt: 200 },
        { voucher_type: 'itc_reversal_r37', account_code: '1111', amt: 200 },
        { voucher_type: 'itc_reavail_r37', account_code: '1112', amt: -300 },
      ],
    });
    expect(t.net_itc).toEqual(tax({ igst: 300, cgst: 600, sgst: 600 }));
    expect(t.itc_reversed_rules).toEqual(tax({ cgst: 80, sgst: 50 }));
    expect(t.itc_reversed_others).toEqual(tax({ cgst: 200, sgst: 200 }));
    expect(t.itc_reclaimed).toEqual(tax({ igst: 300 }));
  });
});
