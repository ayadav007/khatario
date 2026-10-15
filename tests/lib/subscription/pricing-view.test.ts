import type { PricingCatalog, PricingPlan } from '@/lib/subscription/pricing-catalog';
import {
  comparisonRows,
  cycleOptions,
  planCardFeatures,
  planCardLimits,
  plansForLine,
  priceForCycle,
} from '@/lib/subscription/pricing-view';

function plan(id: string, features: string[], over: Partial<PricingPlan> = {}): PricingPlan {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    description: '',
    productLine: 'billing',
    priceMonthly: 0,
    priceYearly: 0,
    price3Year: 0,
    badge: null,
    features,
    limits: {},
    ...over,
  };
}

const catalog: PricingCatalog = {
  features: [
    { id: 'sales_invoices', category: 'sales', label: 'GST invoices', rank: 1 },
    { id: 'reports_gst', category: 'reports', label: 'GST reports', rank: 2 },
    { id: 'whatsapp_auto_reminders', category: 'integrations', label: 'Auto reminders', rank: 1 },
    { id: 'settings_pos_mode', category: 'settings', label: 'POS screen', rank: 3 },
    { id: 'advanced_ledger', category: 'advanced', label: 'Ledger', rank: 4 },
  ],
  limits: [
    { key: 'max_users', one: 'user', many: 'users', rank: 1 },
    { key: 'max_branches', one: 'branch', many: 'branches', rank: 2 },
  ],
  plans: [
    plan('free', ['sales_invoices', 'reports_gst'], { limits: { max_users: 1, max_branches: 1 } }),
    plan('growth', ['sales_invoices', 'reports_gst', 'whatsapp_auto_reminders', 'settings_pos_mode'], {
      priceMonthly: 399,
      priceYearly: 3588,
      price3Year: 7999,
      badge: 'Most popular',
      limits: { max_users: 3, max_branches: 1 },
    }),
    plan('business', ['sales_invoices', 'reports_gst', 'whatsapp_auto_reminders', 'settings_pos_mode', 'advanced_ledger'], {
      priceMonthly: 999,
      priceYearly: 9588,
      price3Year: 21999,
      limits: { max_users: -1, max_branches: 3 },
    }),
    plan('connect', [], { productLine: 'connect', priceMonthly: 1499 }),
  ],
};

describe('pricing view', () => {
  const billing = plansForLine(catalog, 'billing');

  it('keeps only plans of the chosen product line, in catalog order', () => {
    expect(billing.map((p) => p.id)).toEqual(['free', 'growth', 'business']);
    expect(plansForLine(catalog, 'connect').map((p) => p.id)).toEqual(['connect']);
  });

  it('lists everything for the first plan and only the additions for later plans, best rank first', () => {
    expect(planCardFeatures(catalog, billing, 0).features.map((f) => f.id)).toEqual(['sales_invoices', 'reports_gst']);
    const growth = planCardFeatures(catalog, billing, 1);
    expect(growth.previous?.id).toBe('free');
    expect(growth.features.map((f) => f.id)).toEqual(['whatsapp_auto_reminders', 'settings_pos_mode']);
    expect(planCardFeatures(catalog, billing, 2).features.map((f) => f.id)).toEqual(['advanced_ledger']);
  });

  it('drops a feature from a plan card as soon as the matrix turns it off', () => {
    const off: PricingCatalog = {
      ...catalog,
      plans: catalog.plans.map((p) => (p.id === 'growth' ? { ...p, features: p.features.filter((f) => f !== 'settings_pos_mode') } : p)),
    };
    const plans = plansForLine(off, 'billing');
    expect(planCardFeatures(off, plans, 1).features.map((f) => f.id)).toEqual(['whatsapp_auto_reminders']);
    // Business still has POS, so it now shows as a Business addition.
    expect(planCardFeatures(off, plans, 2).features.map((f) => f.id)).toEqual(['settings_pos_mode', 'advanced_ledger']);
  });

  it('ignores enabled features that are hidden from pricing', () => {
    const hidden: PricingCatalog = { ...catalog, features: catalog.features.filter((f) => f.id !== 'advanced_ledger') };
    expect(planCardFeatures(hidden, plansForLine(hidden, 'billing'), 2).features).toEqual([]);
  });

  it('shows limit chips that are set and differ from the previous plan', () => {
    expect(planCardLimits(catalog, billing[0], null)).toEqual(['1 user', '1 branch']);
    expect(planCardLimits(catalog, billing[1], billing[0])).toEqual(['3 users']);
    expect(planCardLimits(catalog, billing[2], billing[1])).toEqual(['Unlimited users', '3 branches']);
  });

  it('builds comparison rows grouped by category with per-plan ticks', () => {
    const rows = comparisonRows(catalog, billing);
    expect(rows[0]).toEqual({ kind: 'group', label: 'Limits' });
    expect(rows[1]).toEqual({ kind: 'limit', label: 'Users', values: [1, 3, -1] });
    const ledger = rows.find((r) => r.kind === 'feature' && r.label === 'Ledger');
    expect(ledger).toEqual({ kind: 'feature', label: 'Ledger', included: [false, false, true] });
    const groups = rows.filter((r) => r.kind === 'group').map((r) => r.label);
    expect(groups).toEqual(['Limits', 'Billing & GST', 'Reports', 'WhatsApp & payments', 'Growth tools', 'Business & team']);
  });

  it('offers yearly and 3-year only when every paid plan has that price, with the best saving', () => {
    const options = cycleOptions(billing);
    expect(options.map((o) => o.id)).toEqual(['monthly', 'yearly', 'three_year']);
    expect(options[1].savePercent).toBe(25);
    expect(options[2].savePercent).toBe(44);
    expect(cycleOptions(plansForLine(catalog, 'connect')).map((o) => o.id)).toEqual(['monthly']);
  });

  it('prices a plan per month for the chosen cycle', () => {
    expect(priceForCycle(billing[1], 'monthly')).toEqual({ perMonth: 399, billed: null });
    expect(priceForCycle(billing[1], 'yearly')).toEqual({ perMonth: 299, billed: 3588 });
    expect(priceForCycle(billing[0], 'yearly')).toEqual({ perMonth: 0, billed: null });
  });
});
