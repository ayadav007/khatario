'use client';

import { clsx } from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_MEDIUM,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { useMarketingEditing } from '@/components/marketing/builder/MarketingEditingContext';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type WalkthroughStep = { title: string; blurb: string; image: string; alt: string };

export type LandingWalkthroughContent = {
  heading: string;
  subtext: string;
  autoRotate: boolean;
  steps: WalkthroughStep[];
};

// Default screenshots are captured from the seeded demo shop by scripts/capture-marketing-screens.mjs.
export const LANDING_WALKTHROUGH_DEFAULTS: LandingWalkthroughContent = {
  heading: 'A simple path from sale to statement',
  subtext: 'Four steps your staff can learn without a day-long “training”.',
  autoRotate: true,
  steps: [
    {
      title: 'Create a GST bill',
      blurb: 'Add items, apply the right HSN and tax, and see totals before you say the number aloud.',
      image: '/marketing/screens/invoice-new.png',
      alt: 'Khatario invoice screen with four grocery items, HSN codes, GST rates and a CGST/SGST total',
    },
    {
      title: 'Send on WhatsApp',
      blurb: 'Share PDF or a payment link in one flow — your customer has proof on the phone they already use.',
      image: '/marketing/screens/invoice-share.png',
      alt: 'Share invoice dialog with Send via WhatsApp, Copy link and Download PDF options',
    },
    {
      title: 'Track payment & credit',
      blurb: 'Mark partial, full, or due — and see the balance next to the name, not buried in a register.',
      image: '/marketing/screens/invoices-list.png',
      alt: 'Invoice list showing paid and unpaid bills with amounts, tax and GSTR-1 status',
    },
    {
      title: 'Open reports for filing',
      blurb: 'GSTR-1 ready views and exports, with less back-and-forth with your CA.',
      image: '/marketing/screens/gstr1.png',
      alt: 'GSTR-1 report with taxable value, tax amount, B2B invoices and export buttons',
    },
  ],
};

const AUTO_MS = 4500;

export function LandingWalkthrough(props: Partial<LandingWalkthroughContent> = {}) {
  const c = withDefaults(LANDING_WALKTHROUGH_DEFAULTS, props);
  const steps = c.steps.filter((s) => s.title || s.image);
  const reduced = usePrefersReducedMotion();
  const editing = useMarketingEditing();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const current = steps[Math.min(active, steps.length - 1)];

  const goTo = useCallback((index: number) => {
    setActive(index);
  }, []);

  useEffect(() => {
    if (reduced || paused || editing || !c.autoRotate || steps.length < 2) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % steps.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [reduced, paused, editing, c.autoRotate, steps.length]);

  if (!current) return null;
  const activeIndex = Math.min(active, steps.length - 1);

  return (
    <section className="scroll-mt-24 bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              {c.heading}
            </h2>
            {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
          </div>
        </LandingReveal>

        <div
          className={`mt-14 w-full ${LANDING_MAX_MEDIUM}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-2">
            {steps.map((step, i) => (
              <div key={i} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={activeIndex === i ? 'step' : undefined}
                  aria-label={step.title}
                  className={clsx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 2xl:h-12 2xl:w-12 2xl:text-base',
                    activeIndex === i
                      ? 'scale-110 bg-slate-900 text-white shadow-md'
                      : 'bg-slate-200 text-slate-600 hover:bg-slate-300',
                  )}
                >
                  {i + 1}
                </button>
                {i < steps.length - 1 && (
                  <div
                    className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200"
                    aria-hidden
                  >
                    <div
                      className={clsx(
                        'h-full bg-slate-700 transition-all duration-500',
                        activeIndex > i ? 'w-full' : activeIndex === i ? 'w-1/2' : 'w-0',
                      )}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm 2xl:mt-10">
            <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(i)}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold transition sm:hidden',
                      activeIndex === i
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    Step {i + 1}
                  </button>
                ))}
              </div>
              <h3
                key={activeIndex}
                className="landing-testimonial-fade-in mt-2 text-xl font-bold text-slate-900 2xl:text-2xl"
              >
                {current.title}
              </h3>
              <p
                key={`${activeIndex}-blurb`}
                className="landing-testimonial-fade-in mt-1 max-w-2xl text-slate-600 2xl:text-lg"
                style={{ animationDelay: '60ms' }}
              >
                {current.blurb}
              </p>
            </div>
            <div className="p-3 sm:p-5 2xl:p-6">
              <div className="relative aspect-[16/10] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
                {steps.map((step, i) =>
                  step.image ? (
                    <div
                      key={i}
                      className={clsx(
                        'absolute inset-0 transition-opacity duration-500',
                        activeIndex === i ? 'opacity-100' : 'opacity-0',
                      )}
                      aria-hidden={activeIndex !== i}
                    >
                      <MarketingImg
                        src={step.image}
                        alt={step.alt}
                        fill
                        sizes="(min-width: 1536px) 1200px, (min-width: 1024px) 80vw, 100vw"
                        className="object-cover object-top"
                      />
                    </div>
                  ) : null,
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-center gap-2" aria-hidden>
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className={clsx(
                  'h-2 rounded-full transition-all duration-300',
                  activeIndex === i ? 'w-6 bg-slate-800' : 'w-2 bg-slate-300',
                )}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
