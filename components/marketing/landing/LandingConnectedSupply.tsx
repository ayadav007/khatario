'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Sparkles, Store, Truck, Bell, PackageCheck, Quote } from 'lucide-react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_WIDE,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';

const RETAILER_POINTS = [
  'Lose fewer sales to empty shelves and “come back later”',
  'Spend less of your day chasing suppliers on the phone',
  'Keep fast movers available when it matters',
  'Suppliers you’re **connected** with can see need earlier — not only after a panic call',
];

const WHOLESALER_POINTS = [
  'See which shops are running tight **before** they ring you',
  'Route vehicles and field visits with clearer priority',
  'Grow repeat orders from the accounts you already serve',
  'Turn scattered demand into a **clear action list**',
];

function stripBoldForList(text: string) {
  return text.split('**');
}

function FormattedListItem({ children }: { children: string }) {
  const parts = stripBoldForList(children);
  if (parts.length === 1) {
    return <>{children.replace(/\*\*/g, '')}</>;
  }
  return (
    <>
      {parts[0]}
      <strong className="font-semibold text-slate-800">{parts[1]}</strong>
      {parts[2] ?? ''}
    </>
  );
}

export function LandingConnectedSupply() {
  const router = useRouter();

  return (
    <section
      id="connected-supply"
      className="scroll-mt-24 border-y border-slate-200/80 bg-gradient-to-b from-white via-slate-50/80 to-white py-20 2xl:py-24"
    >
      <div className={LANDING_PAGE_GUTTER}>
        <div className={`mb-4 inline-flex w-full max-md:justify-center md:justify-start`}>
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600 shadow-sm sm:text-sm">
            <Sparkles className="h-3.5 w-3.5 text-amber-500" strokeWidth={2} aria-hidden />
            Connected supply intelligence
          </span>
        </div>

        <div className={LANDING_SECTION_INTRO}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
            Your supply chain, finally in sync
          </h2>
          <p className={LANDING_INTRO_SUBTEXT}>
            <strong className="font-semibold text-slate-800">Connected Supply Intelligence</strong> is not
            just another low-stock beep. It is coordination between the shop and the supplier — so issues get
            handled <em>before</em> they cost you a sale.
          </p>
        </div>

        <p className="mt-2 max-w-3xl text-sm text-slate-500 max-md:mx-auto max-md:text-center md:text-left 2xl:text-base">
          Works best when <span className="font-medium text-slate-600">your supplier (or you as supplier)</span> is
          connected on the platform. Everyone stays honest about what is low, what is urgent, and who should move
          next.
        </p>

        <div
          className={`mt-12 grid w-full items-stretch gap-8 lg:mt-16 lg:grid-cols-[1fr_minmax(12rem,14rem)_1fr] lg:gap-4 xl:gap-6 2xl:gap-8 ${LANDING_MAX_WIDE}`}
        >
          {/* Retailer card */}
          <div className="order-1 flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7 2xl:p-8">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800 ring-1 ring-slate-200/80"
                aria-hidden
              >
                <Store className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">For retailers</p>
                <p className="text-lg font-bold text-slate-900 2xl:text-xl">Your shop, less chaos</p>
              </div>
            </div>
            <ul className="mt-1 flex flex-1 flex-col gap-3 text-slate-600 2xl:gap-3.5 2xl:text-lg">
              {RETAILER_POINTS.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.2} />
                  <span>
                    <FormattedListItem>{line}</FormattedListItem>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Center flow — desktop: vertical; mobile: own row between cards in order */}
          <div className="order-2 flex flex-col items-center justify-center gap-2 py-2 lg:order-2 lg:min-h-[18rem] lg:py-0">
            <p className="mb-1 text-center text-[0.7rem] font-bold uppercase tracking-widest text-slate-400 lg:mb-2">
              How it flows
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
                    Low stock detected
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
                    Supplier notified
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
                    Refill in motion
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-3 max-w-[12rem] text-center text-[0.65rem] leading-snug text-slate-400 lg:max-w-none lg:text-xs">
              One loop: detect → nudge → act. No new spreadsheet.
            </p>
          </div>

          {/* Wholesaler card */}
          <div className="order-3 flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:order-3 lg:p-7 2xl:p-8">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-800 ring-1 ring-slate-200/80"
                aria-hidden
              >
                <Truck className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">For wholesalers</p>
                <p className="text-lg font-bold text-slate-900 2xl:text-xl">Demand you can read</p>
              </div>
            </div>
            <ul className="mt-1 flex flex-1 flex-col gap-3 text-slate-600 2xl:gap-3.5 2xl:text-lg">
              {WHOLESALER_POINTS.map((line) => (
                <li key={line} className="flex gap-2.5">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={2.2} />
                  <span>
                    <FormattedListItem>{line}</FormattedListItem>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Micro story */}
        <figure
          className={`mt-10 border-l-4 border-amber-400/90 bg-amber-50/40 py-4 pl-5 pr-4 lg:mt-12 lg:pl-6 ${LANDING_MAX_WIDE}`}
        >
          <div className="mb-1 flex items-center gap-2 text-amber-800/90">
            <Quote className="h-4 w-4 fill-current" aria-hidden />
            <span className="text-xs font-bold uppercase tracking-wide">Real life</span>
          </div>
          <blockquote className="text-base leading-relaxed text-slate-800 2xl:text-lg">
            A kirana runs low on cooking oil. <strong className="font-semibold">Before</strong> the owner finishes
            dialling the distributor, the team on the other side can already <strong className="font-semibold">see</strong>{' '}
            the need and <strong className="font-semibold">plan</strong> the next trip — not after the rack is
            empty.
          </blockquote>
        </figure>

        {/* CTA row */}
        <div className="mt-10 flex w-full flex-col items-stretch justify-start gap-3 sm:flex-row sm:items-center lg:mt-12">
          <button
            type="button"
            onClick={() => router.push('/book-demo')}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-6 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700"
          >
            See how it works
            <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => router.push('/signup')}
            className="inline-flex items-center justify-center rounded-xl border-2 border-slate-200 bg-white px-6 py-3.5 text-base font-semibold text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Start free trial
          </button>
        </div>
      </div>
    </section>
  );
}
