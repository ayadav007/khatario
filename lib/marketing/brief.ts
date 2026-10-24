export type MarketingBrief = {
  audience: string;
  offer: string;
  cities: string;
  bannedClaims: string;
  landingUrl: string;
  dailyAdCapRupees: number;
  stopMinSpendRupees: number;
  stopMaxCostPerResultRupees: number;
  ageMin: number;
  ageMax: number;
  interestKeywords: string;
};

export const DEFAULT_MARKETING_BRIEF: MarketingBrief = {
  audience: 'Shopkeepers and small business owners in India who need GST invoices',
  offer: 'Simple GST billing and khata on the phone',
  cities: '',
  bannedClaims: '',
  landingUrl: 'https://khatario.com/signup',
  dailyAdCapRupees: 500,
  stopMinSpendRupees: 300,
  stopMaxCostPerResultRupees: 150,
  ageMin: 24,
  ageMax: 55,
  interestKeywords: 'small business, accounting, GST',
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function normalizeBrief(raw: unknown): MarketingBrief {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const str = (key: keyof MarketingBrief, fallback: string) => {
    const value = src[key];
    return typeof value === 'string' ? value.trim() : fallback;
  };
  let ageMin = num(src.ageMin, DEFAULT_MARKETING_BRIEF.ageMin, 18, 65);
  let ageMax = num(src.ageMax, DEFAULT_MARKETING_BRIEF.ageMax, 18, 65);
  if (ageMax < ageMin) ageMax = ageMin;
  return {
    audience: str('audience', DEFAULT_MARKETING_BRIEF.audience),
    offer: str('offer', DEFAULT_MARKETING_BRIEF.offer),
    cities: str('cities', ''),
    bannedClaims: str('bannedClaims', ''),
    landingUrl: str('landingUrl', DEFAULT_MARKETING_BRIEF.landingUrl),
    dailyAdCapRupees: num(src.dailyAdCapRupees, DEFAULT_MARKETING_BRIEF.dailyAdCapRupees, 0, 1_000_000),
    stopMinSpendRupees: num(src.stopMinSpendRupees, DEFAULT_MARKETING_BRIEF.stopMinSpendRupees, 0, 1_000_000),
    stopMaxCostPerResultRupees: num(
      src.stopMaxCostPerResultRupees,
      DEFAULT_MARKETING_BRIEF.stopMaxCostPerResultRupees,
      0,
      1_000_000,
    ),
    ageMin,
    ageMax,
    interestKeywords: str('interestKeywords', DEFAULT_MARKETING_BRIEF.interestKeywords),
  };
}

export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees <= 0) {
    throw new Error('Daily budget must be greater than zero');
  }
  return Math.round(rupees * 100);
}

export function assertWithinDailyCap(paise: number, capRupees: number): void {
  if (!(capRupees > 0)) {
    throw new Error('Set a daily ad cap in Setup before creating an ad');
  }
  const capPaise = Math.round(capRupees * 100);
  if (paise > capPaise) {
    throw new Error(`Daily budget cannot exceed ₹${capRupees}`);
  }
}
