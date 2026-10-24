import {
  advanceAdjustmentLines,
  advanceReceiptLines,
  advanceRefundLines,
  financialYearLabel,
  proportionalReversal,
  splitAdvanceGst,
  type AdvanceAccounts,
} from '@/lib/accounting/advances';
import { buildAdvanceTables } from '@/lib/gst/gstr1-advances';

const acc: AdvanceAccounts = {
  customerAdvance: '2106',
  supplierAdvance: '1107',
  receivable: '1103',
  payable: '2101',
  outputCgst: '2150',
  outputSgst: '2151',
  outputIgst: '2152',
  outputCess: '2153',
};

const balanced = (lines: Array<{ debit: number; credit: number }>) => {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  return Math.abs(dr - cr) < 0.005;
};

describe('splitAdvanceGst', () => {
  it('goods advances carry no GST', () => {
    expect(splitAdvanceGst({ amount: 11800, supplyType: 'goods', taxRate: 18, intraState: true })).toEqual({
      taxable: 11800, cgst: 0, sgst: 0, igst: 0, cess: 0,
    });
  });
  it('service advance is tax-inclusive, intra-state splits CGST/SGST', () => {
    expect(splitAdvanceGst({ amount: 11800, supplyType: 'services', taxRate: 18, intraState: true })).toEqual({
      taxable: 10000, cgst: 900, sgst: 900, igst: 0, cess: 0,
    });
  });
  it('inter-state service advance is IGST', () => {
    expect(splitAdvanceGst({ amount: 5900, supplyType: 'services', taxRate: 18, intraState: false }).igst).toBe(900);
  });
  it('advance paid to a supplier carries no GST', () => {
    expect(splitAdvanceGst({ amount: 1000, supplyType: 'services', taxRate: 18, intraState: true, type: 'paid' }).cgst).toBe(0);
  });
});

describe('proportionalReversal', () => {
  const split = { taxable: 10000, cgst: 900, sgst: 900, igst: 0, cess: 0 };
  it('reverses a proportional share, then the remainder exactly', () => {
    const first = proportionalReversal({
      advanceAmount: 11800, advanceSplit: split, consumedBefore: 0,
      reversedBefore: { taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 }, portion: 3933.33,
    });
    expect(first.cgst).toBe(300);
    const second = proportionalReversal({
      advanceAmount: 11800, advanceSplit: split, consumedBefore: 3933.33, reversedBefore: first, portion: 7866.67,
    });
    expect(first.cgst + second.cgst).toBeCloseTo(900, 2);
    expect(first.taxable + second.taxable).toBeCloseTo(10000, 2);
  });
});

describe('voucher lines', () => {
  const split = { taxable: 10000, cgst: 900, sgst: 900, igst: 0, cess: 0 };
  it('receipt: Dr bank 11800, Cr advance 10000, Cr output GST 1800', () => {
    const lines = advanceReceiptLines({ type: 'received', amount: 11800, split, paymentAccountId: 'bank', accounts: acc, label: 'x' });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountId === '2106')?.credit).toBe(10000);
    expect(lines.find((l) => l.accountId === '2150')?.credit).toBe(900);
  });
  it('adjustment reverses advance GST so invoice GST is not paid twice', () => {
    const lines = advanceAdjustmentLines({ type: 'received', amount: 11800, reversal: split, accounts: acc, label: 'x' });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountId === '2150')?.debit).toBe(900);
    expect(lines.find((l) => l.accountId === '1103')?.credit).toBe(11800);
  });
  it('supplier advance adjusts payable against 1107', () => {
    const lines = advanceAdjustmentLines({ type: 'paid', amount: 500, reversal: { ...split, taxable: 500 }, accounts: acc, label: 'x' });
    expect(lines).toEqual([
      expect.objectContaining({ accountId: '2101', debit: 500 }),
      expect.objectContaining({ accountId: '1107', credit: 500 }),
    ]);
  });
  it('refund voucher reverses GST and pays out', () => {
    const lines = advanceRefundLines({ type: 'received', amount: 11800, reversal: split, paymentAccountId: 'bank', accounts: acc, label: 'x' });
    expect(balanced(lines)).toBe(true);
    expect(lines.find((l) => l.accountId === 'bank')?.credit).toBe(11800);
  });
});

describe('financialYearLabel', () => {
  it('April starts a new FY', () => {
    expect(financialYearLabel('2026-03-31')).toBe('2025-26');
    expect(financialYearLabel('2026-04-01')).toBe('2026-27');
  });
});

describe('GSTR-1 Table 11A / 11B', () => {
  const m = (taxable: number, cgst: number) => ({ pos: '27', rate: 18, taxable, igst: 0, cgst, sgst: cgst, cess: 0 });
  it('nets same-period adjustments out of 11A and puts earlier-period ones in 11B', () => {
    const { at, atadj } = buildAdvanceTables({
      receivedInPeriod: [m(10000, 900)],
      consumedSamePeriod: [m(4000, 360)],
      consumedFromEarlier: [m(2000, 180)],
    });
    expect(at).toEqual([expect.objectContaining({ place_of_supply: '27', rate: 18, taxable_value: 6000, cgst: 540 })]);
    expect(atadj).toEqual([expect.objectContaining({ taxable_value: 2000, sgst: 180 })]);
  });
  it('fully adjusted in the same period drops out of 11A', () => {
    const { at } = buildAdvanceTables({ receivedInPeriod: [m(10000, 900)], consumedSamePeriod: [m(10000, 900)], consumedFromEarlier: [] });
    expect(at).toEqual([]);
  });
});
