import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

/**
 * Shown on the marketing homepage when `/api/public/pricing` errors or the DB is not seeded, so prices
 * stay visible in local dev and during outages. Prices only: feature lists always come from the live
 * plan matrix, so none are listed here. Values align with `database/migrations/360_plan_catalog_v2.sql`.
 */
export const FALLBACK_PRICING_CATALOG: PricingCatalog = {
  features: [],
  limits: [],
  plans: [
    {
      id: 'free',
      name: 'Free',
      description: 'Unlimited GST invoices for one user, with WhatsApp invoice sending from your own number.',
      productLine: 'billing',
      priceMonthly: 0,
      priceYearly: 0,
      price3Year: 0,
      badge: null,
      features: [],
      limits: {},
    },
    {
      id: 'growth',
      name: 'Growth',
      description: 'For shops and traders: automatic WhatsApp payment reminders, inventory, POS and 3 users.',
      productLine: 'billing',
      priceMonthly: 399,
      priceYearly: 3588,
      price3Year: 7999,
      badge: 'Most popular',
      features: [],
      limits: {},
    },
    {
      id: 'business',
      name: 'Business',
      description: 'Full accounting, multiple branches and warehouses, online store and 10 users.',
      productLine: 'billing',
      priceMonthly: 999,
      priceYearly: 9588,
      price3Year: 21999,
      badge: null,
      features: [],
      limits: {},
    },
    {
      id: 'connect',
      name: 'Connect',
      description: 'Official WhatsApp Business API, shared inbox, AI agent, templates, campaigns and WhatsApp shop.',
      productLine: 'connect',
      priceMonthly: 1499,
      priceYearly: 14388,
      price3Year: 34999,
      badge: null,
      features: [],
      limits: {},
    },
  ],
};
