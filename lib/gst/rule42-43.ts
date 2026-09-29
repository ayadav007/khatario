/**
 * Rules 42 and 43 CGST Rules — reversal of common input tax credit when inputs / input services
 * (Rule 42) or capital goods (Rule 43) are used partly for exempt supplies (including nil-rated
 * and non-taxable) or non-business purposes. Pure calculation per tax head, so it can be tested
 * and reused by a posting job independently of any UI.
 *
 * E (exempt turnover) and F (total turnover in the State) are passed in already computed under
 * the Explanations to the rules; this module does not derive them.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Rule42Inputs {
  /** T: total input tax on inputs and input services for the period */
  T: number;
  /** T1: exclusively for non-business purposes */
  T1: number;
  /** T2: exclusively for exempt supplies */
  T2: number;
  /** T3: blocked under s.17(5) */
  T3: number;
  /** T4: exclusively for taxable supplies (incl. zero-rated) */
  T4: number;
  /** E: exempt turnover for the period */
  E: number;
  /** F: total turnover in the State / UT for the period */
  F: number;
  /**
   * Rule 42(1)(i) Explanation: where there is no turnover in the period, E/F of the last tax
   * period with turnover is used. Pass it here as a ratio (0..1).
   */
  fallbackRatio?: number;
  /** Whether common credit is also used for non-business purposes (D2 = 5% of C2). */
  commonUsedForNonBusiness?: boolean;
}

export interface Rule42Result {
  C1: number;
  C2: number;
  D1: number;
  D2: number;
  C3: number;
  /** Credit to reverse (not claim) for the period: T1 + T2 + T3 + D1 + D2 */
  ineligible: number;
  ratio: number;
}

export function exemptRatio(E: number, F: number, fallbackRatio?: number): number {
  if (F > 0) return Math.min(1, Math.max(0, E / F));
  if (fallbackRatio !== undefined) return Math.min(1, Math.max(0, fallbackRatio));
  return 0;
}

export function computeRule42(i: Rule42Inputs): Rule42Result {
  const C1 = r2(i.T - (i.T1 + i.T2 + i.T3));
  const C2 = r2(Math.max(0, C1 - i.T4));
  const ratio = exemptRatio(i.E, i.F, i.fallbackRatio);
  const D1 = r2(ratio * C2);
  const D2 = i.commonUsedForNonBusiness ? r2(0.05 * C2) : 0;
  const C3 = r2(C2 - (D1 + D2));
  return { C1, C2, D1, D2, C3, ineligible: r2(i.T1 + i.T2 + i.T3 + D1 + D2), ratio };
}

export interface Rule42AnnualTrueUp {
  /** D1 + D2 recomputed on the FY's E / F and common credit */
  annualReversal: number;
  /** Sum of D1 + D2 already reversed month by month */
  monthlyReversed: number;
  /** > 0: reverse this further (with interest u/s 50 from 1 April of next FY). */
  additionalReversal: number;
  /** > 0: claim back this excess reversal. */
  reclaim: number;
}

/**
 * Rule 42(2): after the FY, D1 and D2 are recomputed on the aggregate values; excess reversal
 * is reclaimed and shortfall reversed, by September's return of the following FY.
 */
export function computeRule42TrueUp(p: {
  annualCommonCredit: number;
  annualE: number;
  annualF: number;
  commonUsedForNonBusiness?: boolean;
  monthlyD1: number[];
  monthlyD2: number[];
}): Rule42AnnualTrueUp {
  const ratio = exemptRatio(p.annualE, p.annualF);
  const annualD1 = r2(ratio * p.annualCommonCredit);
  const annualD2 = p.commonUsedForNonBusiness ? r2(0.05 * p.annualCommonCredit) : 0;
  const annualReversal = r2(annualD1 + annualD2);
  const monthlyReversed = r2([...p.monthlyD1, ...p.monthlyD2].reduce((s, n) => s + n, 0));
  const diff = r2(annualReversal - monthlyReversed);
  return {
    annualReversal,
    monthlyReversed,
    additionalReversal: diff > 0 ? diff : 0,
    reclaim: diff < 0 ? -diff : 0,
  };
}

export interface CommonCapitalGood {
  /** ITC on the capital good (A) */
  itc: number;
  /** Months of the 60-month useful life already elapsed before this period */
  monthsUsed: number;
}

/**
 * Rule 43: common capital goods — Tm = A / 60 per month for 5 years; Tr = Σ Tm of goods still
 * within their 60-month life; Te = (E / F) × Tr is added to output tax for the month.
 */
export function computeRule43(p: {
  goods: CommonCapitalGood[];
  E: number;
  F: number;
  fallbackRatio?: number;
}): { Tr: number; Te: number; ratio: number } {
  const Tr = r2(p.goods.filter((g) => g.monthsUsed < 60).reduce((s, g) => s + g.itc / 60, 0));
  const ratio = exemptRatio(p.E, p.F, p.fallbackRatio);
  return { Tr, Te: r2(ratio * Tr), ratio };
}
