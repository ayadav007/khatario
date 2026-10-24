'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { PRODUCT_LINE_LABELS } from '@/lib/product-lines';
import { X, ArrowRight, Sparkles } from 'lucide-react';

/** Once the modal has been shown this browser session, do not show again (survives refresh). */
const SESSION_FIRED_KEY = 'khatario_landing_trial_modal_fired';
/** Visitors who leave within this window were never going to read a pitch. */
const MIN_DWELL_MS = 20_000;
const MIN_SCROLL_PROGRESS = 0.25;

/**
 * Exit-intent trial prompt: desktop pointer only (phones already have the sticky CTA), fired when the
 * cursor leaves through the top of the window, once per session, and never while pricing is on screen.
 */
export function LandingScrollTrialModal() {
  const router = useRouter();
  const { productLine, signupHref } = useLandingProduct();
  const productLabel = PRODUCT_LINE_LABELS[productLine];
  const [open, setOpen] = useState(false);
  const openedRef = useRef(false);
  const maxProgressRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (sessionStorage.getItem(SESSION_FIRED_KEY) === '1') return;

    const startedAt = Date.now();

    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable > 0) {
        maxProgressRef.current = Math.max(maxProgressRef.current, window.scrollY / scrollable);
      }
    };

    const pricingVisible = () => {
      const rect = document.getElementById('pricing')?.getBoundingClientRect();
      return !!rect && rect.top < window.innerHeight && rect.bottom > 0;
    };

    const onMouseOut = (e: MouseEvent) => {
      if (openedRef.current || e.relatedTarget || e.clientY > 0) return;
      if (Date.now() - startedAt < MIN_DWELL_MS) return;
      if (maxProgressRef.current < MIN_SCROLL_PROGRESS) return;
      if (pricingVisible()) return;
      openedRef.current = true;
      sessionStorage.setItem(SESSION_FIRED_KEY, '1');
      setOpen(true);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('mouseout', onMouseOut);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('mouseout', onMouseOut);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={close}
        role="presentation"
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="landing-trial-modal-title"
        className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:max-w-lg sm:p-8"
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-primary-600">
          <Sparkles className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <h2 id="landing-trial-modal-title" className="pr-8 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {productLine === 'connect'
            ? 'Ready for WhatsApp CRM?'
            : `Try Khatario ${productLabel} — free`}
        </h2>
        <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">
          {productLine === 'connect'
            ? 'Create a free Connect account — add Bot or Send Message add-ons when you need them. No platform fee.'
            : productLine === 'hr'
              ? 'Start a 30-day HR trial: employees, attendance, payroll, and leave — no card to begin.'
              : 'Before you go — try GST billing, stock and WhatsApp invoices free. No card needed.'}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => {
              close();
              router.push(signupHref);
            }}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3.5 text-base font-semibold text-white transition hover:bg-primary-700 sm:flex-none sm:px-6"
          >
            Start free trial
            <ArrowRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              router.push('/book-demo');
            }}
            className="inline-flex items-center justify-center rounded-xl border-2 border-slate-200 px-5 py-3.5 text-base font-semibold text-slate-800 transition hover:bg-slate-50"
          >
            Book a demo
          </button>
        </div>
        <button
          type="button"
          onClick={close}
          className="mt-4 w-full text-center text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
