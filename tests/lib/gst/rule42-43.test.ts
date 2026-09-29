import { computeRule42, computeRule42TrueUp, computeRule43, exemptRatio } from '@/lib/gst/rule42-43';

describe('Rule 42 — common input credit (Run 11 L10)', () => {
  const base = { T: 10000, T1: 500, T2: 1000, T3: 500, T4: 3000, E: 200000, F: 1000000 };

  it('computes C1, C2, D1 and C3 per the rule', () => {
    const r = computeRule42(base);
    expect(r.C1).toBe(8000);
    expect(r.C2).toBe(5000);
    expect(r.ratio).toBe(0.2);
    expect(r.D1).toBe(1000);
    expect(r.D2).toBe(0);
    expect(r.C3).toBe(4000);
    expect(r.ineligible).toBe(3000);
  });

  it('D2 = 5% of common credit when also used for non-business purposes', () => {
    const r = computeRule42({ ...base, commonUsedForNonBusiness: true });
    expect(r.D2).toBe(250);
    expect(r.C3).toBe(3750);
  });

  it('only taxable supplies: nothing reversed from common credit', () => {
    expect(computeRule42({ ...base, E: 0 }).D1).toBe(0);
  });

  it('only exempt / nil supplies: whole common credit reversed', () => {
    expect(computeRule42({ ...base, E: 1000000 }).C3).toBe(0);
  });

  it('no turnover in the month: uses last period ratio (Explanation to 42(1))', () => {
    expect(exemptRatio(0, 0, 0.3)).toBe(0.3);
    expect(computeRule42({ ...base, E: 0, F: 0, fallbackRatio: 0.3 }).D1).toBe(1500);
  });
});

describe('Rule 42(2) — annual true-up', () => {
  it('shortfall → additional reversal', () => {
    const t = computeRule42TrueUp({
      annualCommonCredit: 60000,
      annualE: 300000,
      annualF: 1000000,
      monthlyD1: Array(12).fill(1000),
      monthlyD2: [],
    });
    expect(t.annualReversal).toBe(18000);
    expect(t.monthlyReversed).toBe(12000);
    expect(t.additionalReversal).toBe(6000);
    expect(t.reclaim).toBe(0);
  });

  it('excess monthly reversal → reclaim', () => {
    const t = computeRule42TrueUp({
      annualCommonCredit: 60000,
      annualE: 100000,
      annualF: 1000000,
      monthlyD1: Array(12).fill(1000),
      monthlyD2: [],
    });
    expect(t.reclaim).toBe(6000);
    expect(t.additionalReversal).toBe(0);
  });
});

describe('Rule 43 — common capital goods', () => {
  it('Te = (E/F) × Σ(A/60) for goods within 60 months', () => {
    const r = computeRule43({
      goods: [
        { itc: 60000, monthsUsed: 10 },
        { itc: 120000, monthsUsed: 59 },
        { itc: 90000, monthsUsed: 60 },
      ],
      E: 250000,
      F: 1000000,
    });
    expect(r.Tr).toBe(3000);
    expect(r.Te).toBe(750);
  });
});
