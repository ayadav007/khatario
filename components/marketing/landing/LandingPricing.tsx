'use client';

import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { LANDING_INTRO_SUBTEXT, LANDING_MAX_WIDE, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { FALLBACK_LANDING_PLANS } from '@/lib/landing-pricing-fallback';

export interface LandingPricingPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  features: {
    limits: {
      max_invoices_per_month: number;
      max_customers: number;
      max_users: number;
      max_whatsapp_per_day: number;
    };
    features: Record<string, boolean>;
  };
  sort_order: number;
}

function getPlanHighlights(planId: string): string[] {
  const highlights: Record<string, string[]> = {
    free: [
      'Up to 20 invoices/month',
      '10 customers & 10 items',
      'Basic invoice templates',
      'PDF generation',
      'Payment tracking',
    ],
    professional: [
      'Up to 500 invoices/month',
      'Unlimited customers & items',
      'All 7 invoice templates',
      'WhatsApp integration (10/day)',
      'Purchase & expense tracking',
      'Up to 3 users',
    ],
    business: [
      'Unlimited invoices',
      'WhatsApp automation (100/day)',
      'GST reports (GSTR-1, GSTR-2)',
      'Multi-branch support',
      'Advanced reports & analytics',
      'Up to 10 users',
      'Auto-backup & restore',
    ],
    enterprise: [
      'Everything unlimited',
      'Payment gateway integration',
      'REST API access',
      'Online store',
      'Custom branding',
      'Priority support',
      'Dedicated account manager',
    ],
  };
  return highlights[planId] || [];
}

type Props = {
  plans: LandingPricingPlan[];
  loading: boolean;
  billingCycle: 'monthly' | 'yearly';
  onBillingCycle: (c: 'monthly' | 'yearly') => void;
};

export function LandingPricing({ plans, loading, billingCycle, onBillingCycle }: Props) {
  const router = useRouter();
  const displayPlans = !loading && plans.length === 0 ? FALLBACK_LANDING_PLANS : plans;

  return (
    <section id="pricing" className="scroll-mt-24 border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`mb-12 ${LANDING_SECTION_INTRO}`}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">Simple pricing, built for small businesses</h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            Affordable plans that do not punish you for growing one counter at a time.
          </p>
          <div className="mt-8 flex max-md:justify-center md:justify-start">
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
              Yearly <span className="text-xs font-bold text-green-600">(Save 20%)</span>
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
            className={`grid w-full grid-cols-1 gap-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-2 lg:gap-7 xl:grid-cols-4 xl:gap-8 2xl:gap-10 ${LANDING_MAX_WIDE}`}
          >
            {displayPlans.map((plan) => {
              const price = billingCycle === 'monthly' ? plan.price_monthly : plan.price_yearly / 12;
              const isPopular = plan.id === 'professional';

              return (
                <div
                  key={plan.id}
                  className={`relative overflow-hidden rounded-2xl border bg-white shadow-md transition hover:shadow-lg ${
                    isPopular ? 'border-2 border-primary-600' : 'border border-slate-200'
                  }`}
                >
                  {isPopular && (
                    <div className="absolute right-0 top-0 rounded-bl-lg bg-primary-600 px-3 py-1 text-xs font-semibold text-white">
                      MOST POPULAR
                    </div>
                  )}

                  <div className="p-6 2xl:p-8">
                    <h3 className="text-2xl font-bold text-slate-900 2xl:text-3xl">{plan.display_name}</h3>
                    <p className="mb-6 mt-1 h-12 text-sm text-slate-600">{plan.description}</p>

                    <div className="mb-6">
                      <div className="flex items-baseline">
                        <span className="text-4xl font-bold text-slate-900">₹{Math.round(price)}</span>
                        <span className="ml-2 text-slate-600">/month</span>
                      </div>
                      {billingCycle === 'yearly' && plan.price_yearly > 0 && (
                        <p className="mt-1 text-sm text-green-700">Billed ₹{plan.price_yearly}/year</p>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push('/signup')}
                      className={`w-full rounded-lg py-3 text-sm font-semibold transition ${
                        isPopular
                          ? 'bg-primary-600 text-white hover:bg-primary-700'
                          : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
                      }`}
                    >
                      {plan.price_monthly === 0 ? 'Start free' : 'Start trial'}
                    </button>

                    <ul className="mt-6 space-y-3">
                      {getPlanHighlights(plan.id).map((feature) => (
                        <li key={feature} className="flex items-start text-sm">
                          <Check className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-green-600" strokeWidth={2} />
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
