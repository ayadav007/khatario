import type { LandingPricingPlan } from '@/components/marketing/landing/LandingPricing';

/**
 * Shown on the marketing homepage when `/api/admin/subscriptions/plans` is empty, errors, or DB is
 * not seeded — keeps pricing visible in local dev and during outages. Values align with
 * `database/migrations/360_plan_catalog_v2.sql`; live prices are edited in Admin → Plans.
 */
export const FALLBACK_LANDING_PLANS: LandingPricingPlan[] = [
  {
    id: 'free',
    name: 'free',
    display_name: 'Free',
    description: 'Unlimited GST invoices for one user, with WhatsApp invoice sending from your own number.',
    price_monthly: 0,
    price_yearly: 0,
    product_line: 'billing',
    sort_order: 1,
    features: { limits: { max_users: 1, max_whatsapp_per_day: 20 }, features: {} },
  },
  {
    id: 'growth',
    name: 'growth',
    display_name: 'Growth',
    description: 'For shops and traders: automatic WhatsApp payment reminders, inventory, POS and 3 users.',
    price_monthly: 399,
    price_yearly: 3588,
    product_line: 'billing',
    sort_order: 2,
    features: { limits: { max_users: 3, max_whatsapp_per_day: 200 }, features: {} },
  },
  {
    id: 'business',
    name: 'business',
    display_name: 'Business',
    description: 'Full accounting, multiple branches and warehouses, online store and 10 users.',
    price_monthly: 999,
    price_yearly: 9588,
    product_line: 'billing',
    sort_order: 3,
    features: { limits: { max_users: 10, max_branches: 3, max_whatsapp_per_day: 500 }, features: {} },
  },
  {
    id: 'connect',
    name: 'connect',
    display_name: 'Connect',
    description: 'Official WhatsApp Business API, shared inbox, AI agent, templates, campaigns and WhatsApp shop.',
    price_monthly: 1499,
    price_yearly: 14388,
    product_line: 'connect',
    sort_order: 20,
    features: { limits: { max_users: 5, max_whatsapp_per_day: 1000, max_ai_replies_per_month: 500 }, features: {} },
  },
];
