import type { PricingCatalog, PricingPlan } from '@/lib/subscription/pricing-catalog';

/**
 * Shown on the marketing homepage when `/api/public/pricing` errors or the DB is not seeded, so prices
 * stay visible in local dev and during outages. Prices only: feature lists always come from the live
 * plan matrix, so none are listed here. Every plan that is on sale is listed (Billing, HR, Connect); prices are
 * the seeded catalogue (`387_billing_plan_ladder.sql` and the HR and Connect plan migrations before it).
 * `tests/lib/subscription/fallback-prices.test.ts` and `tests/db/fallback-prices.db.test.ts` fail when a
 * price here differs from the seed; change a price in the catalogue first, then here.
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
      bundledHrPlanId: 'hr_staff_lite',
      priceMonthly: 299,
      priceYearly: 2699,
      price3Year: 5999,
    }),
    plan({
      id: 'billing_growth',
      name: 'Growth',
      description: 'Everything in Starter plus full accounting and 5 users. HR Starter included.',
      productLine: 'billing',
      bundledHrPlanId: 'hr_starter',
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
      bundledHrPlanId: 'hr_pro',
      priceMonthly: 799,
      priceYearly: 7199,
      price3Year: 15999,
    }),
    plan({
      id: 'hr_staff_lite',
      name: 'HR Lite',
      description: 'Comes with Starter: up to 30 staff, attendance and simple payroll.',
      productLine: 'hr',
      priceMonthly: 0,
      priceYearly: 0,
      price3Year: 0,
    }),
    plan({
      id: 'hr_starter',
      name: 'HR Starter',
      description: 'Everything in HR Lite plus the Khatario Staff app, shifts and holidays, payroll setup, expenses and commissions.',
      productLine: 'hr',
      priceMonthly: 199,
      priceYearly: 1990,
      price3Year: 0,
    }),
    plan({
      id: 'hr_pro',
      name: 'HR Pro',
      description: 'Everything in HR Starter plus leave, the employee portal, hiring and onboarding, and HR reports.',
      productLine: 'hr',
      priceMonthly: 499,
      priceYearly: 4990,
      price3Year: 0,
      badge: 'Most popular',
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
