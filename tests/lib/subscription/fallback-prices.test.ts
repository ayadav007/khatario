import { FALLBACK_PRICING_CATALOG } from '@/lib/landing-pricing-fallback';
import { LANDING_HERO_COPY } from '@/lib/product-lines';

/**
 * The seeded catalogue, read from the migrations (387_billing_plan_ladder.sql and the HR / Connect plan
 * seeds) and checked against the disposable database in tests/db/fallback-prices.db.test.ts.
 * Plans on sale only. A yearly or 3-year price of 0 on a paid plan means the cycle is not offered.
 */
const SEEDED_ON_SALE: Record<string, { monthly: number; yearly: number; threeYear: number; line: string }> = {
  free: { monthly: 0, yearly: 0, threeYear: 0, line: 'billing' },
  billing_starter: { monthly: 299, yearly: 2699, threeYear: 5999, line: 'billing' },
  billing_growth: { monthly: 499, yearly: 4499, threeYear: 9999, line: 'billing' },
  billing_business: { monthly: 799, yearly: 7199, threeYear: 15999, line: 'billing' },
  hr_staff_lite: { monthly: 0, yearly: 0, threeYear: 0, line: 'hr' },
  hr_starter: { monthly: 199, yearly: 1990, threeYear: 0, line: 'hr' },
  hr_pro: { monthly: 499, yearly: 4990, threeYear: 0, line: 'hr' },
  connect: { monthly: 1499, yearly: 14388, threeYear: 34999, line: 'connect' },
};

describe('outage fallback price table', () => {
  const byId = new Map(FALLBACK_PRICING_CATALOG.plans.map((p) => [p.id, p]));

  it('lists every plan on sale and nothing else', () => {
    expect([...byId.keys()].sort()).toEqual(Object.keys(SEEDED_ON_SALE).sort());
  });

  it.each(Object.entries(SEEDED_ON_SALE))('%s matches the seeded price and product line', (id, seeded) => {
    const plan = byId.get(id)!;
    expect(plan.priceMonthly).toBe(seeded.monthly);
    expect(plan.priceYearly).toBe(seeded.yearly);
    expect(plan.price3Year).toBe(seeded.threeYear);
    expect(plan.productLine).toBe(seeded.line);
  });

  it('bundles the HR plan the seed bundles with each paid Billing plan, and none with Free', () => {
    expect(byId.get('free')!.bundledHrPlanId).toBeNull();
    expect(byId.get('billing_starter')!.bundledHrPlanId).toBe('hr_staff_lite');
    expect(byId.get('billing_growth')!.bundledHrPlanId).toBe('hr_starter');
    expect(byId.get('billing_business')!.bundledHrPlanId).toBe('hr_pro');
  });

  it('the Connect landing footnote quotes the yearly price per month of the Connect plan', () => {
    const perMonth = Math.round(byId.get('connect')!.priceYearly / 12);
    expect(LANDING_HERO_COPY.connect.footnote).toContain(`₹${perMonth.toLocaleString('en-IN')}/month billed yearly`);
  });
});
