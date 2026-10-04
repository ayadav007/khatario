'use client';

import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { FALLBACK_LANDING_PLANS } from '@/lib/landing-pricing-fallback';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { type ProductLine } from '@/lib/product-lines';
import { LandingProductToggle } from '@/components/marketing/landing/LandingProductToggle';
import { useLandingPlans } from '@/components/marketing/landing/LandingPlansContext';
import { withDefaults } from '@/lib/marketing-builder/merge';

export interface LandingPricingPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  product_line?: ProductLine | string;
  features: {
    limits: Partial<Record<string, number>>;
    features: Record<string, boolean>;
  };
  sort_order: number;
}

function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Trials, lapsed states and retired plans are never sold on the landing page. */
const HIDDEN_PLAN_IDS = new Set([
  'trial',
  'hr_trial',
  'hr_free',
  'connect_free',
  'professional',
  'enterprise',
]);

const CONNECT_PLAN_ID = 'connect';

function usersLabel(limit: number | undefined): string | null {
  if (limit === undefined || limit === 0) return null;
  if (limit === -1) return 'Unlimited users';
  return limit === 1 ? '1 user' : `Up to ${limit} users`;
}

function getPlanHighlights(plan: LandingPricingPlan): string[] {
  const limits = plan.features?.limits ?? {};
  const users = usersLabel(limits.max_users);
  const highlights: Record<string, (string | null)[]> = {
    free: [
      'Unlimited GST invoices, customers & items',
      'Send invoices on WhatsApp from your own number',
      'Send payment reminders yourself',
      'GST reports & backups',
      users,
    ],
    growth: [
      'Everything in Free',
      'Automatic WhatsApp payment reminders',
      'Inventory, purchase orders & expenses',
      'POS mode & barcode labels',
      'Payment links & email reminders',
      'Your own branding on invoices',
      users,
    ],
    business: [
      'Everything in Growth',
      'Full accounting ledger',
      limits.max_branches && limits.max_branches > 1
        ? `Up to ${limits.max_branches} branches & multiple warehouses`
        : 'Multiple branches & warehouses',
      'Online store & multi-currency',
      'Advanced analytics & report builder',
      'API access',
      users,
    ],
    [CONNECT_PLAN_ID]: [
      'Official WhatsApp Business API on your number',
      'Shared team inbox',
      limits.max_ai_replies_per_month === -1
        ? 'Unlimited AI agent replies'
        : limits.max_ai_replies_per_month
          ? `${limits.max_ai_replies_per_month.toLocaleString('en-IN')} AI agent replies a month`
          : 'AI agent replies',
      'Meta-approved message templates',
      'Campaigns, automation & WhatsApp shop',
      users,
    ],
    hr_starter: [
      'Employee records & profiles',
      'Daily attendance tracking',
      'Up to 50 employees',
      'Up to 5 team users',
    ],
    hr_pro: [
      'Everything in Starter',
      'Payroll & payslips',
      'Leave management',
      'Employee self-service portal',
      'Up to 200 employees',
    ],
  };
  return (highlights[plan.id] ?? []).filter((h): h is string => !!h);
}

/** Largest yearly saving across the shown plans, as a whole percentage. */
function maxYearlySavingPercent(plans: LandingPricingPlan[]): number {
  let best = 0;
  for (const plan of plans) {
    const monthly = Number(plan.price_monthly) || 0;
    const yearly = Number(plan.price_yearly) || 0;
    if (monthly <= 0 || yearly <= 0) continue;
    best = Math.max(best, Math.round((1 - yearly / (monthly * 12)) * 100));
  }
  return best;
}

/** Editable headings for the Billing plans; HR and Connect keep their built-in copy. Plans always come live from the API. */
export type LandingPricingContent = {
  billingTitle: string;
  billingSubtitle: string;
  showProductToggle: boolean;
};

export const LANDING_PRICING_DEFAULTS: LandingPricingContent = {
  billingTitle: 'Simple pricing, built for small businesses',
  billingSubtitle: 'Affordable plans that do not punish you for growing one counter at a time.',
  showProductToggle: true,
};

function getPricingCopy(productLine: ProductLine, content: LandingPricingContent) {
  switch (productLine) {
    case 'hr':
      return {
        title: 'HR pricing for teams of every size',
        subtitle: 'Start with attendance, upgrade to payroll when you are ready.',
      };
    case 'connect':
      return {
        title: 'Connect: the official WhatsApp Business API',
        subtitle: 'One add-on for your own WhatsApp Business number, AI replies, templates, the shared inbox and automation.',
      };
    default:
      return { title: content.billingTitle, subtitle: content.billingSubtitle };
  }
}

export function LandingPricing(props: Partial<LandingPricingContent> = {}) {
  const content = withDefaults(LANDING_PRICING_DEFAULTS, props);
  const { plans, loading, billingCycle, setBillingCycle: onBillingCycle } = useLandingPlans();
  const router = useRouter();
  const { productLine, signupHref } = useLandingProduct();
  const pricingCopy = getPricingCopy(productLine, content);

  const displayPlans = (!loading && plans.length === 0 ? FALLBACK_LANDING_PLANS : plans)
    .filter((plan) => {
      if (HIDDEN_PLAN_IDS.has(plan.id)) return false;
      const line = (plan.product_line as ProductLine | undefined) ?? 'billing';
      return line === productLine;
    });

  const isPopular = (planId: string) =>
    productLine === 'hr' ? planId === 'hr_pro' : planId === 'growth';
  const yearlySaving = maxYearlySavingPercent(displayPlans);

  return (
    <section id="pricing" className="scroll-mt-24 border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`mb-12 ${LANDING_SECTION_INTRO}`}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            {pricingCopy.title}
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>{pricingCopy.subtitle}</p>
          {content.showProductToggle && (
            <div className="mt-8 flex flex-wrap items-center gap-3 max-md:justify-center md:justify-start">
              <LandingProductToggle label="Show pricing for" />
            </div>
          )}
          <div className="mt-4 flex max-md:justify-center md:justify-start">
            <div className="inline-flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <button
                type="button"
                onClick={() => onBillingCycle('monthly')}
                className={`rounded-lg px-6 py-2.5 text-sm font-semibold transition sm:px-8 sm:text-base ${
                  billingCycle === 'monthly' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:text-primary-600'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => onBillingCycle('yearly')}
                className={`rounded-lg px-6 py-2.5 text-sm font-semibold transition sm:px-8 sm:text-base ${
                  billingCycle === 'yearly' ? 'bg-primary-600 text-white' : 'text-slate-600 hover:text-primary-600'
                }`}
              >
                Yearly
                {yearlySaving > 0 && (
                  <span
                    className={clsx(
                      'ml-1 text-xs font-bold',
                      billingCycle === 'yearly' ? 'text-white/90' : 'text-primary-600',
                    )}
                  >
                    (Save up to {yearlySaving}%)
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center 2xl:py-16">
            <div
              className="inline-block h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-primary-600 2xl:h-14 2xl:w-14"
              role="status"
              aria-label="Loading pricing"
            />
          </div>
        ) : (
          <div
            className={clsx(
              'mx-auto grid w-full grid-cols-1 gap-6 sm:gap-6 lg:gap-7 xl:gap-8 2xl:gap-10',
              displayPlans.length === 1 && 'max-w-md',
              displayPlans.length === 2 && 'max-w-4xl sm:grid-cols-2',
              displayPlans.length === 3 && 'sm:grid-cols-2 xl:grid-cols-3',
              displayPlans.length >= 4 && 'sm:grid-cols-2 xl:grid-cols-4',
              LANDING_MAX_WIDE,
            )}
          >
            {displayPlans.map((plan) => {
              const monthly = Number(plan.price_monthly) || 0;
              const yearly = Number(plan.price_yearly) || 0;
              const price = billingCycle === 'monthly' ? monthly : yearly / 12;
              const popular = isPopular(plan.id);

              return (
                <div
                  key={plan.id}
                  className={`relative overflow-hidden rounded-2xl border bg-white shadow-md transition hover:shadow-lg ${
                    popular ? 'border-2 border-primary-600' : 'border border-slate-200'
                  }`}
                >
                  {popular && (
                    <div className="absolute right-0 top-0 rounded-bl-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white">
                      MOST POPULAR
                    </div>
                  )}

                  <div className="p-6 2xl:p-8">
                    <h3 className="text-2xl font-bold text-slate-900 2xl:text-3xl">{plan.display_name}</h3>
                    <p className="mb-6 mt-1 h-12 text-sm text-slate-600">{plan.description}</p>

                    <div className="mb-6">
                      <div className="flex items-baseline">
                        <span className="text-4xl font-bold text-slate-900">{formatRupees(price)}</span>
                        <span className="ml-2 text-slate-600">/month</span>
                      </div>
                      {billingCycle === 'yearly' && yearly > 0 && (
                        <p className="mt-1 text-sm text-primary-700">Billed {formatRupees(yearly)}/year</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push(signupHref)}
                      className={`w-full rounded-lg py-3 text-sm font-semibold transition ${
                        popular
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                      }`}
                    >
                      {monthly === 0 ? 'Start free' : plan.id === CONNECT_PLAN_ID ? 'Get started' : 'Start trial'}
                    </button>
                    {plan.id === CONNECT_PLAN_ID && (
                      <p className="mt-2 text-center text-xs text-slate-500">
                        Add it to any Khatario plan. Sending invoices from a QR-linked number stays free.
                      </p>
                    )}

                    <ul className="mt-6 space-y-3">
                      {getPlanHighlights(plan).map((feature) => (
                        <li key={feature} className="flex items-start text-sm">
                          <Check className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-primary-600" strokeWidth={2} />
                          <span className="text-slate-700">{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </section>
  );
}
