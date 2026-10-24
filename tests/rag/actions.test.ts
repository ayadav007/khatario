jest.mock('@/lib/db', () => ({ queryRows: jest.fn(), query: jest.fn(), queryOne: jest.fn() }));
jest.mock('@/lib/subscription/list-plans', () => ({ listActiveSubscriptionPlans: jest.fn() }));

import { citedIndexes } from '@/lib/rag/prompt';
import { pickPlan, RecommendInputSchema } from '@/lib/rag/actions/recommend';
import { normalizeIndianMobile } from '@/lib/rag/actions/leads';

describe('citedIndexes', () => {
  it('returns cited source numbers in first-use order without duplicates', () => {
    expect(citedIndexes('Yes [2]. Also [1][2] and again [2].', 3)).toEqual([2, 1]);
  });

  it('drops numbers outside the source list', () => {
    expect(citedIndexes('See [0], [4] and [12].', 3)).toEqual([]);
    expect(citedIndexes('No citations here.', 3)).toEqual([]);
  });
});

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    ['98765-43210', '9876543210'],
  ])('%s -> %s', (raw, expected) => expect(normalizeIndianMobile(raw)).toBe(expected));

  it.each(['5876543210', '987654321', '98765432101', '+1 415 555 0100', ''])('rejects %s', (raw) => {
    expect(normalizeIndianMobile(raw)).toBeNull();
  });
});

describe('pickPlan', () => {
  const plan = (
    id: string,
    price: number,
    limits: Record<string, number>,
    features: Record<string, boolean> = {},
    product_line = 'billing',
    sort_order = 0,
  ) => ({ id, display_name: id.toUpperCase(), price_monthly: price, price_yearly: price * 10, product_line, sort_order, features: { limits, features } });

  const plans = [
    plan('trial', 0, { max_invoices_per_month: -1, max_users: -1 }, { reports_gst: true }),
    plan('basic', 199, { max_invoices_per_month: 100, max_users: 1, max_branches: 1 }),
    plan('standard', 499, { max_invoices_per_month: 1000, max_users: 3, max_branches: 1 }, { reports_gst: true }),
    plan('pro', 999, { max_invoices_per_month: -1, max_users: 10, max_branches: 5 }, { reports_gst: true, advanced_online_store: true }),
    plan('hr_basic', 299, { max_employees: 25 }, { hr_payroll: true }, 'hr'),
  ];
  const input = (over: Record<string, unknown>) => RecommendInputSchema.parse(over);

  it('picks the cheapest plan that fits, never a trial plan', () => {
    expect(pickPlan(plans, input({ invoicesPerMonth: 50 }))?.planId).toBe('basic');
  });

  it('moves up for volume, users, branches and features', () => {
    expect(pickPlan(plans, input({ invoicesPerMonth: 500 }))?.planId).toBe('standard');
    expect(pickPlan(plans, input({ users: 5 }))?.planId).toBe('pro');
    expect(pickPlan(plans, input({ branches: 3 }))?.planId).toBe('pro');
    expect(pickPlan(plans, input({ needs: ['gst_reports'] }))?.planId).toBe('standard');
    expect(pickPlan(plans, input({ needs: ['online_store'] }))?.planId).toBe('pro');
  });

  it('reports needs no plan offers instead of pretending', () => {
    const rec = pickPlan(plans, input({ needs: ['gst_reports', 'multi_warehouse'] }));
    expect(rec?.planId).toBe('standard');
    expect(rec?.unmet).toEqual(['multiple warehouses']);
  });

  it('falls back to the largest plan when nothing fits', () => {
    expect(pickPlan(plans, input({ users: 50 }))?.planId).toBe('pro');
  });

  it('stays within the requested product line', () => {
    const rec = pickPlan(plans, input({ product: 'hr', employees: 10 }));
    expect(rec?.planId).toBe('hr_basic');
    expect(rec?.trialUrl).toBe('/signup?src=assistant&product=hr');
    expect(pickPlan(plans, input({ product: 'whatsapp' }))).toBeNull();
  });

  it('uses prices from the plan rows', () => {
    const rec = pickPlan(plans, input({}));
    expect(rec).toMatchObject({ priceMonthly: 199, priceYearly: 1990 });
  });
});
