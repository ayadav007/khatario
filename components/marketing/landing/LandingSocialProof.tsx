'use client';

import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { LandingCountUp } from '@/components/marketing/landing/LandingCountUp';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';

const SECTOR_CHIPS = [
  'Retail & grocery',
  'Restaurants & F&B',
  'Distribution & wholesale',
  'Services & repairs',
  'Traders & stockists',
  'Pharmacy & wellness',
] as const;

export function LandingSocialProof() {
  const marqueeChips = [...SECTOR_CHIPS, ...SECTOR_CHIPS];

  return (
    <section className="overflow-hidden border-b border-slate-200/80 bg-white py-10 2xl:py-14">
      <div className={LANDING_PAGE_GUTTER}>
        <div className="w-full">
          <LandingReveal>
            <p className="w-full text-center text-sm font-medium uppercase tracking-wider text-slate-500 max-md:mx-auto md:text-left xl:text-base">
              Built for the kind of businesses that live or die on the counter
            </p>
            <p className="mt-2 max-w-2xl text-sm text-slate-500 max-md:mx-auto max-md:text-center md:text-left 2xl:text-base">
              Teams across <strong className="font-medium text-slate-700">retail, wholesale, and services</strong>{' '}
              use Khatario for bills, stock, and payments — in towns and cities across India.
            </p>
          </LandingReveal>

          <div className="relative mt-6 md:hidden">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white to-transparent" />
            <div className="overflow-hidden">
              <div className="landing-marquee-track flex w-max gap-2">
                {marqueeChips.map((label, i) => (
                  <div
                    key={`${label}-${i}`}
                    className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm"
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 hidden flex-wrap items-center justify-start gap-2 sm:gap-3 md:flex xl:mt-6 xl:gap-3 2xl:mt-7">
            {SECTOR_CHIPS.map((label, i) => (
              <LandingReveal key={label} delay={i * 60}>
                <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md 2xl:px-4 2xl:text-sm">
                  {label}
                </div>
              </LandingReveal>
            ))}
          </div>

          <div className="mt-10 grid w-full grid-cols-1 gap-6 sm:grid-cols-3 sm:gap-8 2xl:mt-14 2xl:gap-10">
            <LandingReveal delay={0}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
                <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">
                  <LandingCountUp value={5000} suffix="+" />
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600">Businesses on Khatario</p>
              </div>
            </LandingReveal>
            <LandingReveal delay={80}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
                <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">
                  <LandingCountUp value={10000} suffix="+" />
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600">Invoices generated (and counting)</p>
              </div>
            </LandingReveal>
            <LandingReveal delay={160}>
              <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-6 text-center max-md:mx-auto max-md:max-w-md sm:text-left 2xl:p-8">
                <p className="text-3xl font-bold text-slate-900 sm:text-4xl 2xl:text-5xl">
                  <LandingCountUp value={4.8} decimals={1} suffix=" / 5" />
                </p>
                <p className="mt-1 text-sm font-medium text-slate-600">Shopkeeper-rated ease of use</p>
              </div>
            </LandingReveal>
          </div>
        </div>
      </div>
    </section>
  );
}
