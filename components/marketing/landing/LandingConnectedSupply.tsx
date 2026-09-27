'use client';

import Link from 'next/link';
import { ArrowRight, Check, Sparkles, Store, Truck, Bell, PackageCheck, Quote } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_WIDE,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { SafeMarkdown } from '@/components/marketing/builder/SafeMarkdown';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingConnectedSupplyContent = {
  badge: string;
  heading: string;
  subtext: string;
  note: string;
  retailerLabel: string;
  retailerTitle: string;
  retailerPoints: { text: string }[];
  flowLabel: string;
  flowStep1: string;
  flowStep2: string;
  flowStep3: string;
  flowCaption: string;
  wholesalerLabel: string;
  wholesalerTitle: string;
  wholesalerPoints: { text: string }[];
  exampleLabel: string;
  example: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
};

export const LANDING_CONNECTED_SUPPLY_DEFAULTS: LandingConnectedSupplyContent = {
  badge: 'For shops and their suppliers',
  heading: 'Your supplier sees low stock before you call',
  subtext:
    'When a shop and its supplier both use Khatario, low stock turns into a restock request the supplier can act on — so the rack gets refilled *before* it costs you a sale.',
  note: 'Works when **your supplier (or you, as a supplier)** is connected on Khatario. Nothing extra to install.',
  retailerLabel: 'For retailers',
  retailerTitle: 'Your shop, less chaos',
  retailerPoints: [
    { text: 'Lose fewer sales to empty shelves and “come back later”' },
    { text: 'Spend less of your day chasing suppliers on the phone' },
    { text: 'Keep fast movers available when it matters' },
    { text: 'Suppliers you’re **connected** with can see need earlier — not only after a panic call' },
  ],
  flowLabel: 'How it flows',
  flowStep1: 'Low stock detected',
  flowStep2: 'Supplier notified',
  flowStep3: 'Refill in motion',
  flowCaption: 'Spot it, tell the supplier, refill. No new spreadsheet.',
  wholesalerLabel: 'For wholesalers',
  wholesalerTitle: 'Demand you can read',
  wholesalerPoints: [
    { text: 'See which shops are running tight **before** they ring you' },
    { text: 'Route vehicles and field visits with clearer priority' },
    { text: 'Grow repeat orders from the accounts you already serve' },
    { text: 'Turn scattered demand into a **clear action list**' },
  ],
  exampleLabel: 'For example',
  example:
    'A kirana runs low on cooking oil. **Before** the owner finishes dialling the distributor, the team on the other side can already **see** the need and **plan** the next trip — not after the rack is empty.',
  primaryLabel: 'See how it works',
  primaryHref: '/book-demo',
  secondaryLabel: 'Start free trial',
  secondaryHref: '/signup',
};

function PointList({ points }: { points: { text: string }[] }) {
  return (
    <ul className="mt-1 flex flex-1 flex-col gap-3 text-slate-600 2xl:gap-3.5 2xl:text-lg">
      {points
        .filter((p) => p.text)
        .map((p, i) => (
          <li key={i} className="flex gap-2.5">
            <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.2} />
            <SafeMarkdown inline text={p.text} className="[&_strong]:text-slate-800" />
          </li>
        ))}
    </ul>
  );
}

function AudienceCard({
  icon,
  label,
  title,
  points,
  order,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  points: { text: string }[];
  order: string;
}) {
  return (
    <div className={`${order} flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7 2xl:p-8`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800 ring-1 ring-slate-200/80"
          aria-hidden
        >
          {icon}
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-lg font-bold text-slate-900 2xl:text-xl">{title}</p>
        </div>
      </div>
      <PointList points={points} />
    </div>
  );
}

export function LandingConnectedSupply(props: Partial<LandingConnectedSupplyContent> = {}) {
  const c = withDefaults(LANDING_CONNECTED_SUPPLY_DEFAULTS, props);

  return (
    <section
      id="connected-supply"
      className="scroll-mt-24 border-y border-slate-200/80 bg-gradient-to-b from-white via-slate-50/80 to-white py-20 2xl:py-24"
    >
      <div className={LANDING_PAGE_GUTTER}>
        {c.badge && (
          <div className="mb-4 inline-flex w-full max-md:justify-center md:justify-start">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 shadow-sm sm:text-sm">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} aria-hidden />
              {c.badge}
            </span>
          </div>
        )}

        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
          {c.subtext && (
            <p className={LANDING_INTRO_SUBTEXT}>
              <SafeMarkdown inline text={c.subtext} />
            </p>
          )}
        </div>

        {c.note && (
          <p className="mt-2 max-w-3xl text-sm text-slate-600 max-md:mx-auto max-md:text-center md:text-left 2xl:text-base">
            <SafeMarkdown inline text={c.note} className="[&_strong]:font-medium [&_strong]:text-slate-800" />
          </p>
        )}

        <div
          className={`mt-12 grid w-full items-stretch gap-8 lg:mt-16 lg:grid-cols-[1fr_minmax(12rem,14rem)_1fr] lg:gap-4 xl:gap-6 2xl:gap-8 ${LANDING_MAX_WIDE}`}
        >
          <AudienceCard
            order="order-1"
            icon={<Store className="h-6 w-6" strokeWidth={1.75} />}
            label={c.retailerLabel}
            title={c.retailerTitle}
            points={c.retailerPoints}
          />

          <div className="order-2 flex flex-col items-center justify-center gap-2 py-2 lg:order-2 lg:min-h-[18rem] lg:py-0">
            <p className="mb-1 text-center text-xs font-bold uppercase tracking-widest text-slate-600 lg:mb-2">
              {c.flowLabel}
            </p>
            <div className="flex w-full max-w-sm flex-col items-stretch gap-0 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-4 shadow-inner lg:max-w-none lg:p-3">
              <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-0">
                <div className="flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 sm:flex-1 sm:flex-col sm:py-3">
                  <span
                    className="inline-flex h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500"
                    style={{ boxShadow: '0 0 0 3px rgba(244, 63, 94, 0.25)' }}
                    aria-hidden
                  />
                  <span className="text-center text-xs font-semibold text-rose-900 sm:text-[0.7rem] lg:text-xs">
                    {c.flowStep1}
                  </span>
                </div>
                <div className="hidden px-0.5 sm:block">
                  <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
                </div>
                <div className="sm:hidden sm:py-0">
                  <div className="mx-auto h-4 w-px flex-1 bg-slate-200" />
                  <ArrowRight className="mx-auto h-4 w-4 rotate-90 text-slate-400" aria-hidden />
                </div>
                <div className="flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm sm:flex-1 sm:flex-col sm:py-3">
                  <span className="relative">
                    <Bell className="h-5 w-5 text-slate-600" strokeWidth={1.75} aria-hidden />
                    <span
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-white"
                      aria-hidden
                    />
                  </span>
                  <span className="text-center text-xs font-semibold text-slate-800 sm:text-[0.7rem] lg:text-xs">
                    {c.flowStep2}
                  </span>
                </div>
                <div className="hidden sm:block sm:px-0.5">
                  <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
                </div>
                <div className="sm:hidden sm:py-0">
                  <div className="mx-auto h-2 w-px flex-1 bg-slate-200" />
                  <ArrowRight className="mx-auto h-4 w-4 rotate-90 text-slate-400" aria-hidden />
                </div>
                <div className="flex w-full min-w-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2.5 sm:flex-1 sm:flex-col sm:py-3">
                  <PackageCheck className="h-5 w-5 text-emerald-700" strokeWidth={1.75} aria-hidden />
                  <span className="text-center text-xs font-semibold text-emerald-900 sm:text-[0.7rem] lg:text-xs">
                    {c.flowStep3}
                  </span>
                </div>
              </div>
            </div>
            {c.flowCaption && (
              <p className="mt-3 max-w-[14rem] text-center text-xs leading-snug text-slate-600 lg:max-w-none lg:text-sm">
                {c.flowCaption}
              </p>
            )}
          </div>

          <AudienceCard
            order="order-3 lg:order-3"
            icon={<Truck className="h-6 w-6" strokeWidth={1.75} />}
            label={c.wholesalerLabel}
            title={c.wholesalerTitle}
            points={c.wholesalerPoints}
          />
        </div>

        {c.example && (
          <figure
            className={`mt-10 border-l-4 border-amber-400/90 bg-amber-50/40 py-4 pl-5 pr-4 lg:mt-12 lg:pl-6 ${LANDING_MAX_WIDE}`}
          >
            <div className="mb-1 flex items-center gap-2 text-amber-800/90">
              <Quote className="h-4 w-4 fill-current" aria-hidden />
              <span className="text-xs font-bold uppercase tracking-wide">{c.exampleLabel}</span>
            </div>
            <blockquote className="text-base leading-relaxed text-slate-800 2xl:text-lg">
              <SafeMarkdown inline text={c.example} />
            </blockquote>
          </figure>
        )}

        {(c.primaryLabel || c.secondaryLabel) && (
          <div className="mt-10 flex w-full flex-col items-stretch justify-start gap-3 sm:flex-row sm:items-center lg:mt-12">
            {c.primaryLabel && (
              <Link
                href={c.primaryHref || '/book-demo'}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700"
              >
                {c.primaryLabel}
                <ArrowRight className="h-5 w-5" aria-hidden />
              </Link>
            )}
            {c.secondaryLabel && (
              <Link
                href={c.secondaryHref || '/signup'}
                className="inline-flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white px-6 py-3.5 text-base font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {c.secondaryLabel}
              </Link>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
