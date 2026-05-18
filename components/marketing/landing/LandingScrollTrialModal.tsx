'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, ArrowRight, Sparkles } from 'lucide-react';

/** Once the modal has been shown this browser session, do not show again (survives refresh). */
const SESSION_FIRED_KEY = 'khatario_landing_trial_modal_fired';
const SCROLL_THRESHOLD = 2 / 3;
/** Min scrollable height (px) before we use scroll position — very short pages skip the modal. */
const MIN_SCROLLABLE = 200;

/**
 * When the user scrolls past 2/3 of the total scrollable height, opens a trial prompt once per
 * browser session (see `SESSION_FIRED_KEY` in this file).
 */
export function LandingScrollTrialModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const raf = useRef<number | null>(null);
  const openedRef = useRef(false);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const tryOpen = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (openedRef.current) return;
    if (sessionStorage.getItem(SESSION_FIRED_KEY) === '1') return;

    const el = document.documentElement;
    const scrollable = el.scrollHeight - window.innerHeight;
    if (scrollable < MIN_SCROLLABLE) return;

    const progress = window.scrollY / scrollable;
    if (progress >= SCROLL_THRESHOLD) {
      openedRef.current = true;
      sessionStorage.setItem(SESSION_FIRED_KEY, '1');
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (raf.current != null) return;
      raf.current = window.requestAnimationFrame(() => {
        raf.current = null;
        tryOpen();
      });
    };

    function onResize() {
      tryOpen();
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    tryOpen();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [tryOpen]);

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
          See your counter on Khatario — free
        </h2>
        <p className="mt-3 text-base leading-relaxed text-slate-600 sm:text-lg">
          You&apos;ve looked through a lot. Start a free trial: GST billing, stock, and WhatsApp in one app — no
          card to begin.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={() => {
              close();
              router.push('/signup');
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
