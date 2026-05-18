import type { LandingPricingPlan } from '@/components/marketing/landing/LandingPricing';

/**
 * Shown on the marketing homepage when `/api/admin/subscriptions/plans` is empty, errors, or DB is
 * not seeded — keeps pricing visible in local dev and during outages. Values align with
 * `database/seed_subscriptions.sql` (adjust there + API if you change live pricing).
 */
const emptyFeatureMatrix: Record<string, boolean> = {};

export const FALLBACK_LANDING_PLANS: LandingPricingPlan[] = [
  {
    id: 'free',
    name: 'free',
    display_name: 'Free / Starter',
    description: 'Perfect for solo freelancers and trying out the platform',
    price_monthly: 0,
    price_yearly: 0,
    sort_order: 1,
    features: {
      limits: {
        max_invoices_per_month: 20,
        max_customers: 10,
        max_users: 1,
        max_whatsapp_per_day: 0,
      },
      features: { ...emptyFeatureMatrix },
    },
  },
  {
    id: 'professional',
    name: 'professional',
    display_name: 'Professional',
    description: 'Growing businesses and retail shops',
    price_monthly: 299,
    price_yearly: 2999,
    sort_order: 2,
    features: {
      limits: {
        max_invoices_per_month: 500,
        max_customers: -1,
        max_users: 3,
        max_whatsapp_per_day: 10,
      },
      features: { ...emptyFeatureMatrix },
    },
  },
  {
    id: 'business',
    name: 'business',
    display_name: 'Business',
    description: 'Established businesses with advanced needs',
    price_monthly: 999,
    price_yearly: 9999,
    sort_order: 3,
    features: {
      limits: {
        max_invoices_per_month: -1,
        max_customers: -1,
        max_users: 10,
        max_whatsapp_per_day: 100,
      },
      features: { ...emptyFeatureMatrix },
    },
  },
  {
    id: 'enterprise',
    name: 'enterprise',
    display_name: 'Enterprise',
    description: 'Large businesses with custom requirements',
    price_monthly: 2999,
    price_yearly: 29999,
    sort_order: 4,
    features: {
      limits: {
        max_invoices_per_month: -1,
        max_customers: -1,
        max_users: -1,
        max_whatsapp_per_day: -1,
      },
      features: { ...emptyFeatureMatrix },
    },
  },
];
