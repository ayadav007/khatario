jest.mock('@/lib/db', () => ({ getPool: jest.fn(), queryOne: jest.fn(), queryRows: jest.fn() }));

import { computeGstr3bCashPayable, computeItcUtilizationDisplay } from '@/lib/gst/gstr3b-ledger';
import { utilizationToLedgerPairs } from '@/lib/gst/gst-settlement';

const base = { igstLiability: 0, cgstLiability: 0, sgstLiability: 0, itcIgst: 0, itcCgst: 0, itcSgst: 0 };
const cash = (n: { igst: number; cgst: number; sgst: number; cess: number }) => n.igst + n.cgst + n.sgst + n.cess;

describe('computeItcUtilizationDisplay (s.49(5), Rule 88A)', () => {
  it('Run 11 L5: IGST ITC is placed where CGST/SGST ITC cannot reach, leaving nil cash', () => {
    const u = computeItcUtilizationDisplay({
      ...base,
      cgstLiability: 100,
      sgstLiability: 100,
      itcIgst: 100,
      itcCgst: 100,
      itcSgst: 0,
    });
    expect(u.igst_to_sgst).toBe(100);
    expect(u.igst_to_cgst).toBe(0);
    expect(u.cgst_to_cgst).toBe(100);
    expect(cash(u.net_payable)).toBe(0);
  });

  it('mirror case: SGST ITC available, CGST short', () => {
    const u = computeItcUtilizationDisplay({
      ...base,
      cgstLiability: 100,
      sgstLiability: 100,
      itcIgst: 100,
      itcSgst: 100,
    });
    expect(u.igst_to_cgst).toBe(100);
    expect(u.sgst_to_sgst).toBe(100);
    expect(cash(u.net_payable)).toBe(0);
  });

  it('IGST ITC is used against IGST liability first', () => {
    const u = computeItcUtilizationDisplay({ ...base, igstLiability: 60, cgstLiability: 50, itcIgst: 100 });
    expect(u.igst_to_igst).toBe(60);
    expect(u.igst_to_cgst).toBe(40);
    expect(u.net_payable.cgst).toBe(10);
  });

  it('IGST ITC against both CGST and SGST when own-head ITC is nil', () => {
    const u = computeItcUtilizationDisplay({ ...base, cgstLiability: 70, sgstLiability: 70, itcIgst: 100 });
    expect(u.igst_to_cgst + u.igst_to_sgst).toBe(100);
    expect(cash(u.net_payable)).toBe(40);
  });

  it('IGST ITC is exhausted before CGST/SGST ITC (Rule 88A proviso)', () => {
    const u = computeItcUtilizationDisplay({
      ...base,
      cgstLiability: 100,
      sgstLiability: 100,
      itcIgst: 150,
      itcCgst: 100,
      itcSgst: 100,
    });
    expect(u.igst_to_cgst + u.igst_to_sgst).toBe(150);
    expect(u.cgst_to_cgst + u.sgst_to_sgst).toBe(50);
    expect(cash(u.net_payable)).toBe(0);
  });

  it('CGST ITC never discharges SGST (and vice versa)', () => {
    const u = computeItcUtilizationDisplay({ ...base, sgstLiability: 100, itcCgst: 500 });
    expect(u.cgst_to_cgst).toBe(0);
    expect(u.net_payable.sgst).toBe(100);
    const v = computeItcUtilizationDisplay({ ...base, cgstLiability: 100, itcSgst: 500 });
    expect(v.net_payable.cgst).toBe(100);
  });

  it('CGST and SGST ITC may discharge IGST after own head', () => {
    const u = computeItcUtilizationDisplay({
      ...base,
      igstLiability: 100,
      cgstLiability: 20,
      sgstLiability: 20,
      itcCgst: 60,
      itcSgst: 60,
    });
    expect(u.cgst_to_cgst).toBe(20);
    expect(u.cgst_to_igst).toBe(40);
    expect(u.sgst_to_sgst).toBe(20);
    expect(u.sgst_to_igst).toBe(40);
    expect(u.net_payable.igst).toBe(20);
  });

  it('never produces negative cash payable', () => {
    const u = computeItcUtilizationDisplay({ ...base, igstLiability: 10, itcIgst: 1000, itcCgst: 1000, itcSgst: 1000 });
    expect(u.net_payable).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });

  describe('compensation cess (Cess Act s.11(2) proviso)', () => {
    it('output cess > input cess: difference paid in cash', () => {
      const u = computeItcUtilizationDisplay({ ...base, cessLiability: 1200, itcCess: 500 });
      expect(u.cess_to_cess).toBe(500);
      expect(u.net_payable.cess).toBe(700);
    });

    it('output cess < input cess: nil payable, balance carried forward', () => {
      const u = computeItcUtilizationDisplay({ ...base, cessLiability: 300, itcCess: 1200 });
      expect(u.cess_to_cess).toBe(300);
      expect(u.net_payable.cess).toBe(0);
    });

    it('output cess = input cess: nil payable', () => {
      const u = computeItcUtilizationDisplay({ ...base, cessLiability: 800, itcCess: 800 });
      expect(u.net_payable.cess).toBe(0);
    });

    it('cess ITC cannot discharge GST, and GST ITC cannot discharge cess', () => {
      const u = computeItcUtilizationDisplay({ ...base, cgstLiability: 100, cessLiability: 100, itcCess: 500, itcIgst: 500 });
      expect(u.net_payable.cgst).toBe(0);
      expect(u.net_payable.cess).toBe(0);
      const v = computeItcUtilizationDisplay({ ...base, cessLiability: 100, itcIgst: 500, itcCgst: 500 });
      expect(v.net_payable.cess).toBe(100);
      const w = computeItcUtilizationDisplay({ ...base, igstLiability: 100, itcCess: 500 });
      expect(w.net_payable.igst).toBe(100);
    });
  });
});

describe('computeGstr3bCashPayable — RCM paid in cash (s.49(4), Run 11 L4)', () => {
  const output = { igst: 0, cgst: 1000, sgst: 1000, cess: 0 };
  const itc = { igst: 0, cgst: 1500, sgst: 1500, cess: 0 };

  it('pooled RCM (2155): ITC does not reduce RCM', () => {
    const r = computeGstr3bCashPayable({
      output,
      itc,
      rcm: { mode: 'pooled', igst: null, cgst: null, sgst: null, total: 900 },
    });
    expect(r.payable_by_head).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
    expect(r.rcm_pooled_cash).toBe(900);
    expect(r.net_tax_payable).toBe(900);
  });

  it('split RCM (2156–2158): same cash result, head-wise, surplus ITC untouched', () => {
    const r = computeGstr3bCashPayable({
      output,
      itc,
      rcm: { mode: 'split', igst: 0, cgst: 450, sgst: 450, total: 900 },
    });
    expect(r.util.cgst_to_cgst).toBe(1000);
    expect(r.util.sgst_to_sgst).toBe(1000);
    expect(r.payable_by_head).toEqual({ igst: 0, cgst: 450, sgst: 450, cess: 0 });
    expect(r.rcm_pooled_cash).toBe(0);
    expect(r.net_tax_payable).toBe(900);
  });

  it('cess is part of net tax payable', () => {
    const r = computeGstr3bCashPayable({
      output: { ...output, cess: 1200 },
      itc: { ...itc, cess: 200 },
      rcm: { mode: 'pooled', igst: null, cgst: null, sgst: null, total: 0 },
    });
    expect(r.payable_by_head.cess).toBe(1000);
    expect(r.net_tax_payable).toBe(1000);
  });
});

describe('utilizationToLedgerPairs (settlement voucher)', () => {
  it('posts the Run 11 L5 allocation and cess set-off to the right accounts', () => {
    const u = computeItcUtilizationDisplay({
      ...base,
      cgstLiability: 100,
      sgstLiability: 100,
      itcIgst: 100,
      itcCgst: 100,
      cessLiability: 50,
      itcCess: 80,
    });
    const pairs = utilizationToLedgerPairs(u);
    expect(pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outCode: '2151', inCode: '1112', amount: 100 }),
        expect.objectContaining({ outCode: '2150', inCode: '1110', amount: 100 }),
        expect.objectContaining({ outCode: '2153', inCode: '1113', amount: 50 }),
      ])
    );
    expect(pairs.some((p) => ['2155', '2156', '2157', '2158'].includes(p.outCode))).toBe(false);
  });
});
