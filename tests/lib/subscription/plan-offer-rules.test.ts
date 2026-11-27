import {
  isPlanOnSale,
  planOfferFor,
  selectOfferedPlans,
  type CurrentPlanRef,
} from '@/lib/subscription/plan-offer-rules';
import { pickUpgradePlansForFeature } from '@/lib/subscription/feature-access-info';

const plan = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  is_active: true,
  is_public: true,
  price_monthly: 299,
  price_yearly: 2699,
  price_3year: null,
  ...extra,
});
const none = new Map<string, CurrentPlanRef>();
const on = (id: string, status = 'active') => new Map([[id, { planId: id, status }]]);

describe('isPlanOnSale', () => {
  it('active and public is on sale, whatever it costs', () => {
    expect(isPlanOnSale(plan('billing_starter'))).toBe(true);
    expect(isPlanOnSale(plan('billing_business', { price_monthly: 1, price_yearly: 1 }))).toBe(true);
    expect(isPlanOnSale(plan('free', { price_monthly: 0, price_yearly: 0 }))).toBe(true);
  });
  it('hidden, inactive, trial and the included HR Lite are not', () => {
    expect(isPlanOnSale(plan('growth', { is_public: false }))).toBe(false);
    expect(isPlanOnSale(plan('billing_growth', { is_active: false }))).toBe(false);
    expect(isPlanOnSale(plan('trial', { is_public: true }))).toBe(false);
    expect(isPlanOnSale(plan('hr_trial', { is_public: true }))).toBe(false);
    expect(isPlanOnSale(plan('hr_staff_lite', { price_monthly: 0, price_yearly: 0 }))).toBe(false);
  });
  it('a missing is_public (before migration 387) counts as public', () => {
    expect(isPlanOnSale({ id: 'billing_starter', is_active: true })).toBe(true);
  });
  it('a hidden plan priced at Rs 1 stays hidden', () => {
    expect(isPlanOnSale(plan('growth', { is_public: false, price_monthly: 1 }))).toBe(false);
  });
});

describe('planOfferFor', () => {
  it('a plan on sale that is not current can be chosen', () => {
    expect(planOfferFor(plan('billing_growth'), none)).toEqual({ on_sale: true, current: false, renewable: false, selectable: true });
  });
  it('a plan not on sale and not current is not listed', () => {
    expect(planOfferFor(plan('growth', { is_public: false }), none)).toBeNull();
    expect(planOfferFor(plan('hr_free', { is_public: false, price_monthly: 0, price_yearly: 0 }), none)).toBeNull();
  });
  it('the current paid plan is current and renewable, even when it is no longer on sale', () => {
    expect(planOfferFor(plan('billing_growth'), on('billing_growth'))).toEqual({ on_sale: true, current: true, renewable: true, selectable: true });
    expect(planOfferFor(plan('growth', { is_public: false }), on('growth'))).toEqual({ on_sale: false, current: true, renewable: true, selectable: true });
  });
  it('the current free plan is current and cannot be chosen', () => {
    expect(planOfferFor(plan('free', { price_monthly: 0, price_yearly: 0 }), on('free'))).toMatchObject({ current: true, renewable: false, selectable: false });
  });
  it('a trial row is current but never renewable', () => {
    expect(planOfferFor(plan('trial', { is_public: false, price_monthly: 0, price_yearly: 0 }), on('trial', 'trial'))).toMatchObject({ current: true, renewable: false, selectable: false });
  });
  it('a current plan that is switched off cannot be renewed', () => {
    expect(planOfferFor(plan('billing_growth', { is_active: false }), on('billing_growth'))).toMatchObject({ current: true, selectable: false });
  });
  it('a plan priced at Rs 1 on the yearly price only still counts as a paid plan', () => {
    expect(planOfferFor(plan('billing_starter', { price_monthly: 0, price_yearly: 1 }), on('billing_starter'))).toMatchObject({ renewable: true });
  });
});

describe('selectOfferedPlans', () => {
  const catalogue = [
    plan('free', { price_monthly: 0, price_yearly: 0 }),
    plan('billing_starter'),
    plan('growth', { is_public: false }),
    plan('trial', { is_public: false, price_monthly: 0, price_yearly: 0 }),
    plan('billing_business', { price_monthly: 1, price_yearly: 1 }),
  ];
  it('keeps catalogue order and adds the offer', () => {
    const out = selectOfferedPlans(catalogue, none);
    expect(out.map((p) => p.id)).toEqual(['free', 'billing_starter', 'billing_business']);
    expect(out.every((p) => p.offer.selectable)).toBe(true);
  });
  it('adds the retired plan the business is on', () => {
    const out = selectOfferedPlans(catalogue, on('growth'));
    expect(out.map((p) => p.id)).toEqual(['free', 'billing_starter', 'growth', 'billing_business']);
    expect(out.find((p) => p.id === 'growth')!.offer).toMatchObject({ current: true, on_sale: false, selectable: true });
  });
});

describe('pickUpgradePlansForFeature', () => {
  const row = (id: string, sort: number, extra: Record<string, unknown> = {}) => ({
    plan_id: id,
    display_name: id,
    price_monthly: 299,
    price_yearly: 2699,
    price_3year: null,
    sort_order: sort,
    is_public: true,
    product_line: 'billing',
    ...extra,
  });
  const rows = [
    row('free', 1, { price_monthly: 0, price_yearly: 0 }),
    row('billing_starter', 2),
    row('billing_growth', 3, { price_monthly: 499 }),
    row('growth', 30, { is_public: false, price_monthly: 1 }),
    row('hr_staff_lite', 9, { product_line: 'hr', price_monthly: 0, price_yearly: 0 }),
    row('hr_starter', 10, { product_line: 'hr', price_monthly: 199 }),
  ];
  const ids = (r: Array<{ plan_id: string }>) => r.map((x) => x.plan_id);

  it('never names a free plan or a hidden plan, however cheap the hidden plan is', () => {
    expect(ids(pickUpgradePlansForFeature(rows, { onSaleOnly: true, productLine: 'billing' }))).toEqual(['billing_starter', 'billing_growth']);
  });
  it('keeps to the feature product line', () => {
    expect(ids(pickUpgradePlansForFeature(rows, { onSaleOnly: true, productLine: 'hr' }))).toEqual(['hr_starter']);
  });
  it('orders by tier, not price: a Rs 1 higher tier does not jump the queue', () => {
    const cheapTop = [row('billing_starter', 2), row('billing_business', 4, { price_monthly: 1, price_yearly: 1 })];
    expect(ids(pickUpgradePlansForFeature(cheapTop, { onSaleOnly: true, productLine: 'billing' }))).toEqual(['billing_starter', 'billing_business']);
  });
  it('points above the current plan of the same product only', () => {
    const out = pickUpgradePlansForFeature(rows, {
      onSaleOnly: true,
      productLine: 'billing',
      current: [{ id: 'billing_starter', sort_order: 2, product_line: 'billing' }],
    });
    expect(ids(out)).toEqual(['billing_growth']);
    const other = pickUpgradePlansForFeature(rows, {
      onSaleOnly: true,
      productLine: 'billing',
      current: [{ id: 'hr_starter', sort_order: 10, product_line: 'hr' }],
    });
    expect(ids(other)).toEqual(['billing_starter', 'billing_growth']);
  });
});
