import type { PricingCatalog, PricingPlan } from '@/lib/subscription/pricing-catalog';

/**
 * Shown on the marketing homepage when `/api/public/pricing` errors or the DB is not seeded, so prices
 * stay visible in local dev and during outages. Prices only: feature lists always come from the live
 * plan matrix, so none are listed here. Values align with `database/migrations/387_billing_plan_ladder.sql`.
 */
const plan = (p: Omit<PricingPlan, 'features' | 'limits' | 'badge' | 'bundledHrPlanId'> & Partial<PricingPlan>): PricingPlan => ({
  badge: null,
  bundledHrPlanId: null,
  features: [],
  limits: {},
  ...p,
});

export const FALLBACK_PRICING_CATALOG: PricingCatalog = {
  features: [],
  limits: [],
  plans: [
    plan({
      id: 'free',
      name: 'Free',
      description: 'Free forever in the Khatario phone app: GST bills, quotations, purchases and GST reports for one user.',
      productLine: 'billing',
      priceMonthly: 0,
      priceYearly: 0,
      price3Year: 0,
    }),
    plan({
      id: 'billing_starter',
      name: 'Starter',
      description: 'Billing on computer and phone with POS, barcodes, reminders and 3 users. HR Lite included.',
      productLine: 'billing',
      priceMonthly: 299,
      priceYearly: 2699,
      price3Year: 5999,
    }),
    plan({
      id: 'billing_growth',
      name: 'Growth',
      description: 'Everything in Starter plus full accounting and 5 users. HR Starter included.',
      productLine: 'billing',
      priceMonthly: 499,
      priceYearly: 4499,
      price3Year: 9999,
      badge: 'Most popular',
    }),
    plan({
      id: 'billing_business',
      name: 'Business',
      description: 'Everything in Growth plus branches, warehouses, online store, e-Invoice and 10 users. HR Pro included.',
      productLine: 'billing',
      priceMonthly: 799,
      priceYearly: 7199,
      price3Year: 15999,
    }),
    plan({
      id: 'connect',
      name: 'Connect',
      description: 'Official WhatsApp Business API, shared inbox, AI agent, templates, campaigns and WhatsApp shop.',
      productLine: 'connect',
      priceMonthly: 1499,
      priceYearly: 14388,
      price3Year: 34999,
    }),
  ],
};
