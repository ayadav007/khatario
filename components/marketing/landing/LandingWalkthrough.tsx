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

const STEPS = [
  {
    n: 1,
    title: 'Create a GST bill',
    blurb: 'Add items, apply the right HSN and tax, and see totals before you say the number aloud.',
  },
  {
    n: 2,
    title: 'Send on WhatsApp',
    blurb: 'Share PDF or a payment link in one flow — your customer has proof on the phone they already use.',
  },
  {
    n: 3,
    title: 'Track payment & credit',
    blurb: 'Mark partial, full, or due — and see the balance next to the name, not buried in a register.',
  },
  {
    n: 4,
    title: 'Open reports for filing',
    blurb: 'GSTR-leaning views and exports with less back-and-forth with your CA.',
  },
] as const;

function StepPreview({ step }: { step: number }) {
  if (step === 1) {
    return (
      <div className="space-y-2 p-4">
        <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
          <div className="flex justify-between font-semibold text-slate-800">
            <span>Rice 5kg</span>
            <span className="tabular-nums">₹590</span>
          </div>
          <div className="mt-1 flex justify-between text-slate-500">
            <span>Oil 1L · 18% GST</span>
            <span className="tabular-nums">₹185</span>
          </div>
        </div>
        <div className="flex justify-between rounded-md bg-slate-100 px-2 py-1.5 text-sm font-bold text-slate-900">
          <span>Total</span>
          <span className="tabular-nums">₹775</span>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-2 bg-[#e5ddd5] p-4">
        <div className="max-w-[80%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
          Invoice #1042 ready?
        </div>
        <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2 text-xs text-slate-800 shadow-sm">
          PDF sent · ₹775 due
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div>
            <p className="text-xs font-semibold text-slate-900">Sharma & Sons</p>
            <p className="text-[11px] text-slate-500">Invoice #1042</p>
          </div>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
            Partial
          </span>
        </div>
        <div className="flex justify-between text-xs text-slate-600">
          <span>Paid</span>
          <span className="font-semibold tabular-nums text-slate-900">₹500</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-slate-600">Balance</span>
          <span className="font-semibold tabular-nums text-red-600">₹275</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <div className="grid grid-cols-4 items-end gap-1 px-1 pt-2">
        {[40, 65, 52, 78].map((h, i) => (
          <div
            key={i}
            className="rounded-t bg-slate-300"
            style={{ height: `${h}px` }}
            aria-hidden
          />
        ))}
      </div>
      <div className="flex gap-2">
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700">
          GSTR-1 export
        </span>
        <span className="rounded-md bg-green-50 px-2 py-1 text-[11px] font-medium text-green-800 ring-1 ring-green-200">
          Ready
        </span>
      </div>
    </div>
  );
}

const AUTO_MS = 4500;

export function LandingWalkthrough() {
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback((index: number) => {
    setActive(index);
  }, []);

  useEffect(() => {
    if (reduced || paused) return;
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % STEPS.length);
    }, AUTO_MS);
    return () => window.clearInterval(id);
  }, [reduced, paused]);

  return (
    <section className="scroll-mt-24 bg-white py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              A simple path from sale to statement
            </h2>
            <p className={LANDING_INTRO_SUBTEXT}>
              Four steps your staff can learn without a day-long “training”.
            </p>
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
            {STEPS.map((step, i) => (
              <div key={step.n} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => goTo(i)}
                  aria-current={active === i ? 'step' : undefined}
                  className={clsx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-300 2xl:h-12 2xl:w-12 2xl:text-base',
                    active === i
                      ? 'scale-110 bg-slate-900 text-white shadow-md'
                      : 'bg-slate-200 text-slate-600 hover:bg-slate-300',
                  )}
                >
                  {step.n}
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-slate-200"
                    aria-hidden
                  >
                    <div
                      className={clsx(
                        'h-full bg-slate-700 transition-all duration-500',
                        active > i ? 'w-full' : active === i ? 'w-1/2' : 'w-0',
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
                {STEPS.map((step, i) => (
                  <button
                    key={step.n}
                    type="button"
                    onClick={() => goTo(i)}
                    className={clsx(
                      'rounded-full px-3 py-1 text-xs font-semibold transition sm:hidden',
                      active === i
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-600',
                    )}
                  >
                    Step {step.n}
                  </button>
                ))}
              </div>
              <h3
                key={active}
                className="landing-testimonial-fade-in mt-2 text-xl font-bold text-slate-900 2xl:text-2xl"
              >
                {STEPS[active].title}
              </h3>
              <p
                key={`${active}-blurb`}
                className="landing-testimonial-fade-in mt-1 max-w-2xl text-slate-600 2xl:text-lg"
                style={{ animationDelay: '60ms' }}
              >
                {STEPS[active].blurb}
              </p>
            </div>
            <div
              key={active}
              className="landing-testimonial-fade-in mx-auto max-w-md overflow-hidden rounded-b-2xl border-t border-slate-200 bg-white shadow-inner sm:max-w-lg"
              role="img"
              aria-label={`${STEPS[active].title} preview`}
            >
              <StepPreview step={STEPS[active].n} />
            </div>
          </div>

          <div className="mt-4 flex justify-center gap-2" aria-hidden>
            {STEPS.map((step, i) => (
              <button
                key={step.n}
                type="button"
                onClick={() => goTo(i)}
                className={clsx(
                  'h-2 rounded-full transition-all duration-300',
                  active === i ? 'w-6 bg-slate-800' : 'w-2 bg-slate-300',
                )}
                aria-label={`Go to step ${step.n}`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
