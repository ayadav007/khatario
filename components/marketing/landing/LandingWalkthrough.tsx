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

const AUTO_MS = 6000;

export function LandingWalkthrough(props: Partial<LandingWalkthroughContent> = {}) {
  const c = withDefaults(LANDING_WALKTHROUGH_DEFAULTS, props);
  const steps = c.steps.filter((s) => s.title || s.image);
  const reduced = usePrefersReducedMotion();
  const editing = useMarketingEditing();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const autoplay = !reduced && !editing && c.autoRotate && steps.length > 1;

  const goTo = useCallback((index: number) => {
    setActive(index);
  }, []);

  useEffect(() => {
    if (!autoplay || paused) return;
    const id = window.setTimeout(() => setActive((i) => (i + 1) % steps.length), AUTO_MS);
    return () => window.clearTimeout(id);
  }, [autoplay, paused, active, steps.length]);

  if (steps.length === 0) return null;
  const activeIndex = Math.min(active, steps.length - 1);

  return (
    <section id="how-it-works" className="scroll-mt-24 bg-slate-50 py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <p className="landing-kicker">How it works</p>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              {c.heading}
            </h2>
            {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
          </div>
        </LandingReveal>

        <div
          className={`mt-12 w-full ${LANDING_MAX_MEDIUM}`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
        >
          <div role="tablist" aria-label="Walkthrough steps" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {steps.map((step, i) => {
              const selected = activeIndex === i;
              return (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => goTo(i)}
                  className={clsx(
                    'relative flex flex-col gap-1 overflow-hidden rounded-2xl border bg-white px-4 py-4 text-left transition duration-300 sm:px-5',
                    selected ? 'border-primary-600 shadow-lg shadow-primary-900/10' : 'border-slate-200 hover:border-slate-300',
                  )}
                >
                  <span className={clsx('text-xs font-bold', selected ? 'text-primary-600' : 'text-slate-400')}>Step {i + 1}</span>
                  <span className="font-bold text-slate-900">{step.title}</span>
                  <span className="hidden text-sm leading-snug text-slate-500 sm:block">{step.blurb}</span>
                  {selected && (
                    <span
                      key={`${i}-${active}`}
                      aria-hidden
                      className={clsx('absolute inset-x-0 bottom-0 h-[3px] origin-left bg-accent-500', autoplay && 'landing-step-progress')}
                      style={{ animationDuration: `${AUTO_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <LandingReveal delay={120}>
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-primary-900/15">
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <p key={activeIndex} className="landing-testimonial-fade-in mx-auto truncate text-xs font-medium text-slate-500 sm:text-sm">
                  {steps[activeIndex].title}
                </p>
              </div>
              <div className="relative aspect-[16/10] overflow-hidden bg-slate-50">
                {steps.map((step, i) =>
                  step.image ? (
                    <div
                      key={i}
                      className={clsx(
                        'absolute inset-0 transition-all duration-700 ease-out motion-reduce:transition-none',
                        activeIndex === i ? 'scale-100 opacity-100' : 'scale-[1.03] opacity-0',
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
          </LandingReveal>
          <p className="mt-3 text-sm text-slate-500 sm:hidden">{steps[activeIndex].blurb}</p>
        </div>
      </div>
    </section>
  );
}
