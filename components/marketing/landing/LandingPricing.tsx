'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, Minus, Plus, UserCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { FALLBACK_PRICING_CATALOG } from '@/lib/landing-pricing-fallback';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { type ProductLine } from '@/lib/product-lines';
import { LandingProductToggle } from '@/components/marketing/landing/LandingProductToggle';
import { useLandingPlans, type BillingCycle } from '@/components/marketing/landing/LandingPlansContext';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingSegmented, useAnimatedNumber } from '@/components/marketing/landing/LandingMotion';
import { withDefaults } from '@/lib/marketing-builder/merge';
import type { PricingCatalog, PricingPlan } from '@/lib/subscription/pricing-catalog';
import {
  bundledHrNote,
  comparisonRows,
  cycleOptions,
  planCardFeatures,
  planCardLimits,
  plansForLine,
  priceForCycle,
} from '@/lib/subscription/pricing-view';

/** Features listed on a card before the rest move to the comparison table. */
const CARD_FEATURE_COUNT = 7;

function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Editable headings for the Billing plans; HR and Connect keep their built-in copy. Plans always come live from the plan matrix. */
export type LandingPricingContent = {
  billingTitle: string;
  billingSubtitle: string;
  showProductToggle: boolean;
};

export const LANDING_PRICING_DEFAULTS: LandingPricingContent = {
  billingTitle: 'Start free. Pay when the shop grows.',
  billingSubtitle:
    'Every plan below comes from the same plan settings that unlock features inside the app, so what you see here is exactly what you get.',
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

function PriceFigure({ value }: { value: number }) {
  const shown = useAnimatedNumber(value, 450);
  return <span className="text-5xl font-extrabold tracking-tight text-slate-900 tabular-nums">{formatRupees(shown)}</span>;
}

function PlanCard({
  catalog,
  plans,
  index,
  cycle,
  signupHref,
  productLine,
  onShowAll,
}: {
  catalog: PricingCatalog;
  plans: PricingPlan[];
  index: number;
  cycle: BillingCycle;
  signupHref: string;
  productLine: ProductLine;
  onShowAll: () => void;
}) {
  const plan = plans[index];
  const { previous, features } = planCardFeatures(catalog, plans, index);
  const limits = planCardLimits(catalog, plan, previous);
  const hrNote = productLine === 'billing' ? bundledHrNote(catalog) : null;
  const { perMonth, billed } = priceForCycle(plan, cycle);
  const featured = !!plan.badge;
  const top = features.slice(0, CARD_FEATURE_COUNT);
  const rest = features.length - top.length;
  const cta =
    plan.priceMonthly === 0
      ? productLine === 'hr'
        ? 'Included with Billing'
        : 'Start free'
      : productLine === 'connect'
        ? 'Get started'
        : 'Start free trial';

  return (
    <article
      className={clsx(
        'relative flex min-w-0 flex-col gap-5 rounded-3xl border bg-white p-7 transition duration-300 hover:-translate-y-1.5 hover:shadow-xl motion-reduce:transition-none motion-reduce:hover:translate-y-0 2xl:p-8',
        featured ? 'landing-popular-ring border-2 border-primary-600 shadow-xl shadow-primary-900/10' : 'border-slate-200 shadow-sm',
      )}
    >
      {plan.badge && (
        <span className="absolute -top-3.5 right-6 rounded-full bg-accent-500 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-white shadow-md shadow-accent-500/40">
          {plan.badge}
        </span>
      )}
      <div>
        <h3 className="text-2xl font-extrabold tracking-tight text-slate-900">{plan.name}</h3>
        <p className="mt-1.5 min-h-[3rem] text-sm leading-relaxed text-slate-500">{plan.description}</p>
      </div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <PriceFigure value={perMonth} />
          <span className="text-slate-500">/ month</span>
        </div>
        <p className="mt-1 min-h-[1.25rem] text-sm font-medium text-primary-600">
          {billed !== null ? `Billed ${formatRupees(billed)} ${cycle === 'yearly' ? 'a year' : 'for 3 years'}` : ''}
        </p>
      </div>
      <Link
        href={signupHref}
        className={clsx(
          'inline-flex w-full items-center justify-center rounded-xl px-5 py-3 text-base font-semibold transition',
          featured
            ? 'bg-primary-600 text-white shadow-md hover:-translate-y-0.5 hover:bg-primary-700'
            : 'border-2 border-primary-600 text-primary-600 hover:bg-primary-50',
        )}
      >
        {cta}
      </Link>
      {plan.id === 'connect' && (
        <p className="-mt-2 text-center text-xs text-slate-500">
          Add it to any Khatario plan. Sending invoices from a QR-linked number stays free.
        </p>
      )}
      {limits.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {limits.map((l) => (
            <span key={l} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {l}
            </span>
          ))}
        </div>
      )}
      {hrNote && (
        <p className="flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-2 text-sm font-semibold text-primary-600">
          <UserCheck className="h-4 w-4 shrink-0" aria-hidden />
          {hrNote}
        </p>
      )}
      {top.length > 0 && (
        <div className="border-t border-slate-100 pt-5">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
            {previous ? `Everything in ${previous.name}, plus` : 'Includes'}
          </p>
          <ul className="space-y-2.5" key={plan.features.join(',')}>
            {top.map((f, i) => (
              <li
                key={f.id}
                className="landing-feature-in grid grid-cols-[1.25rem_1fr] gap-2.5 text-[15px] text-slate-700"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Check className="mt-0.5 h-5 w-5 text-primary-600" strokeWidth={2.4} aria-hidden />
                <span>{f.label}</span>
              </li>
            ))}
          </ul>
          {rest > 0 && (
            <button
              type="button"
              onClick={onShowAll}
              className="mt-3 text-sm font-semibold text-primary-600 underline-offset-4 hover:underline"
            >
              + {rest} more in the comparison
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function ComparisonTable({ catalog, plans }: { catalog: PricingCatalog; plans: PricingPlan[] }) {
  const rows = useMemo(() => comparisonRows(catalog, plans), [catalog, plans]);
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto border-t border-slate-200">
      <table className="w-full min-w-[560px] border-collapse text-[15px]">
        <thead>
          <tr>
            <th scope="col" className="px-5 py-3 text-left font-semibold text-slate-500">
              Feature
            </th>
            {plans.map((p) => (
              <th key={p.id} scope="col" className="px-5 py-3 text-center text-base font-bold text-slate-900">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) =>
            row.kind === 'group' ? (
              <tr key={`g-${row.label}`}>
                <td colSpan={plans.length + 1} className="bg-slate-50 px-5 py-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  {row.label}
                </td>
              </tr>
            ) : (
              <tr key={`${row.kind}-${row.label}-${i}`} className="border-b border-slate-100 hover:bg-slate-50/70">
                <td className="px-5 py-2.5 text-slate-700">{row.label}</td>
                {row.kind === 'limit'
                  ? row.values.map((v, k) => (
                      <td key={k} className="px-5 py-2.5 text-center font-semibold tabular-nums text-slate-800">
                        {v === null ? <Minus className="mx-auto h-4 w-4 text-slate-300" aria-label="Not included" /> : v === -1 ? 'Unlimited' : v.toLocaleString('en-IN')}
                      </td>
                    ))
                  : row.included.map((yes, k) => (
                      <td key={k} className="px-5 py-2.5 text-center">
                        {yes ? (
                          <Check className="mx-auto h-5 w-5 text-primary-600" strokeWidth={2.4} aria-label="Included" />
                        ) : (
                          <Minus className="mx-auto h-4 w-4 text-slate-300" aria-label="Not included" />
                        )}
                      </td>
                    ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function LandingPricing(props: Partial<LandingPricingContent> = {}) {
  const content = withDefaults(LANDING_PRICING_DEFAULTS, props);
  const { catalog: liveCatalog, loading, billingCycle, setBillingCycle } = useLandingPlans();
  const { productLine, signupHref } = useLandingProduct();
  const [compareOpen, setCompareOpen] = useState(false);
  const pricingCopy = getPricingCopy(productLine, content);

  const catalog = !loading && (!liveCatalog || liveCatalog.plans.length === 0) ? FALLBACK_PRICING_CATALOG : liveCatalog;
  const plans = catalog ? plansForLine(catalog, productLine) : [];
  const cycles = cycleOptions(plans);
  const cycle = cycles.some((c) => c.id === billingCycle) ? billingCycle : 'monthly';

  const showAll = () => {
    setCompareOpen(true);
    requestAnimationFrame(() => document.getElementById('pricing-compare')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <section id="pricing" className="scroll-mt-24 border-t border-slate-200/80 bg-gradient-to-b from-slate-50 to-white py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal className={`mb-10 ${LANDING_SECTION_INTRO}`}>
          <p className="landing-kicker">Pricing</p>
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{pricingCopy.title}</h2>
          <p className={LANDING_INTRO_SUBTEXT}>{pricingCopy.subtitle}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3 max-md:justify-center md:justify-start">
            {content.showProductToggle && <LandingProductToggle label="Show pricing for" />}
            {cycles.length > 1 && (
              <LandingSegmented<BillingCycle>
                ariaLabel="Billing cycle"
                value={cycle}
                onChange={setBillingCycle}
                options={cycles.map((c) => ({
                  id: c.id,
                  label: (
                    <>
                      {c.label}
                      {c.savePercent > 0 && (
                        <span className={clsx('ml-1.5 text-xs font-bold', cycle === c.id ? 'text-accent-200' : 'text-accent-600')}>
                          −{c.savePercent}%
                        </span>
                      )}
                    </>
                  ),
                }))}
              />
            )}
          </div>
        </LandingReveal>

        {loading || !catalog ? (
          <div className="py-12 text-center">
            <div className="inline-block h-12 w-12 animate-spin rounded-full border-2 border-slate-200 border-t-primary-600" role="status" aria-label="Loading pricing" />
          </div>
        ) : (
          <>
            <div
              className={clsx(
                'mx-auto grid w-full grid-cols-1 items-start gap-6 xl:gap-8',
                plans.length === 1 && 'max-w-md',
                plans.length === 2 && 'max-w-4xl sm:grid-cols-2',
                plans.length === 3 && 'md:grid-cols-2 xl:grid-cols-3',
                plans.length >= 4 && 'sm:grid-cols-2 xl:grid-cols-4',
              )}
            >
              {plans.map((plan, i) => (
                <LandingReveal key={plan.id} delay={i * 80}>
                  <PlanCard
                    catalog={catalog}
                    plans={plans}
                    index={i}
                    cycle={cycle}
                    signupHref={signupHref}
                    productLine={productLine}
                    onShowAll={showAll}
                  />
                </LandingReveal>
              ))}
            </div>

            {catalog.features.length > 0 && (
              <details
                id="pricing-compare"
                open={compareOpen}
                onToggle={(e) => setCompareOpen((e.currentTarget as HTMLDetailsElement).open)}
                className="group mt-10 scroll-mt-28 overflow-hidden rounded-2xl border border-slate-200 bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-5 text-lg font-bold text-slate-900 [&::-webkit-details-marker]:hidden">
                  Compare every feature
                  <Plus className="h-5 w-5 text-primary-600 transition-transform duration-300 group-open:rotate-45" aria-hidden />
                </summary>
                <ComparisonTable catalog={catalog} plans={plans} />
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
