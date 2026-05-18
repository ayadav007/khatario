'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, MapPin, Shield } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';

const HERO_ROTATE_WORDS = ['calmer', 'simpler'] as const;

const LONGEST_HERO_WORD = [...HERO_ROTATE_WORDS].sort((a, b) => b.length - a.length)[0];
const HERO_ROTATE_MS = 3600;
/** Must match `landing-hero-word-exit-down` in globals.css */
const HERO_EXIT_MS = 420;
/** Must match `landing-hero-word-enter-up` in globals.css */
const HERO_ENTER_MS = 480;

type HeroWordAnim = 'idle' | 'exit' | 'enter';

export function LandingHero() {
  const router = useRouter();
  const [heroWordIdx, setHeroWordIdx] = useState(0);
  const [reduceHeroMotion, setReduceHeroMotion] = useState(false);
  const [heroWordAnim, setHeroWordAnim] = useState<HeroWordAnim>('idle');
  const heroCycleTimersRef = useRef<{ exit?: number; enter?: number }>({});
  const rotatingWord = HERO_ROTATE_WORDS[heroWordIdx];

  const heroGhostMeasureRef = useRef<HTMLSpanElement>(null);
  const [heroSlotPx, setHeroSlotPx] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceHeroMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  /** Simple rotate when reduced motion — same interval; always show `rotatingWord` below */
  useEffect(() => {
    if (!reduceHeroMotion) return;
    const id = window.setInterval(() => {
      setHeroWordIdx((i) => (i + 1) % HERO_ROTATE_WORDS.length);
    }, HERO_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceHeroMotion]);

  /**
   * Timers advance exit → enter → idle so we don't rely on `animationEnd`
   * (often missing when animations are skipped or in some browsers).
   */
  useEffect(() => {
    if (reduceHeroMotion) return;

    const clearHeroTimers = () => {
      const t = heroCycleTimersRef.current;
      if (t.exit) window.clearTimeout(t.exit);
      if (t.enter) window.clearTimeout(t.enter);
      heroCycleTimersRef.current = {};
    };

    const runCycle = () => {
      clearHeroTimers();
      setHeroWordAnim('exit');

      heroCycleTimersRef.current.exit = window.setTimeout(() => {
        setHeroWordIdx((i) => (i + 1) % HERO_ROTATE_WORDS.length);
        setHeroWordAnim('enter');

        heroCycleTimersRef.current.enter = window.setTimeout(() => {
          setHeroWordAnim('idle');
        }, HERO_ENTER_MS);
      }, HERO_EXIT_MS);
    };

    const intervalId = window.setInterval(runCycle, HERO_ROTATE_MS);
    return () => {
      window.clearInterval(intervalId);
      clearHeroTimers();
    };
  }, [reduceHeroMotion]);

  /** Slot width from longest ghost label — shorter words align right inside slot so “way.” doesn’t jump; flex gap avoids overlap with “There is a”. */
  useLayoutEffect(() => {
    if (heroWordAnim !== 'idle') return;

    const ghost = heroGhostMeasureRef.current;
    if (!ghost) return;

    const sync = () => setHeroSlotPx(ghost.offsetWidth);

    sync();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(ghost);
    window.addEventListener('resize', sync);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [rotatingWord, heroWordAnim]);

  return (
    <section
      className={`${LANDING_PAGE_GUTTER} border-b border-slate-200/80 bg-gradient-to-b from-slate-50 via-white to-slate-50/80 py-16 md:py-20 lg:py-24 2xl:py-28`}
    >
      <div className="grid w-full items-center gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-20 2xl:gap-24">
        <div className="text-left">
          <p className="mb-4 inline-flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
              <BadgeCheck className="h-4 w-4 text-green-600" aria-hidden />
              GST-ready invoicing
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">
              <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
              Made for India
            </span>
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[2.75rem] xl:text-[3.25rem] 2xl:text-[3.5rem] 2xl:leading-[1.08]">
            Still billing by hand at closing time?{' '}
            <span className="inline-flex flex-wrap items-baseline gap-x-1">
              <span className="text-primary-600 whitespace-nowrap">There is a</span>
              <span
                className="relative inline-flex shrink-0 justify-end pb-0.5 align-baseline text-accent-600"
                style={{
                  width: heroSlotPx > 0 ? heroSlotPx : undefined,
                }}
              >
                {/* Off-screen width sample for longest word — matches headline font via inherit */}
                <span
                  ref={heroGhostMeasureRef}
                  aria-hidden
                  className="pointer-events-none absolute whitespace-nowrap opacity-0 select-none"
                  style={{
                    left: -9999,
                    top: 0,
                    font: 'inherit',
                    fontWeight: 'inherit',
                    letterSpacing: 'inherit',
                    lineHeight: 'inherit',
                  }}
                >
                  {LONGEST_HERO_WORD}
                </span>
                <span
                  className={
                    reduceHeroMotion
                      ? 'inline-block'
                      : heroWordAnim === 'exit'
                        ? 'landing-hero-word-exit-down inline-block'
                        : heroWordAnim === 'enter'
                          ? 'landing-hero-word-enter-up inline-block'
                          : 'inline-block'
                  }
                >
                  {rotatingWord}
                </span>
              </span>
              <span className="text-primary-600 whitespace-nowrap">way.</span>
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl xl:max-w-2xl 2xl:max-w-3xl 2xl:text-[1.35rem] 2xl:leading-relaxed">
            Khatario turns your counter into one simple flow: bill with correct GST, share on WhatsApp, track
            who has paid, and file reports — without wrestling spreadsheets or the CA at midnight.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={() => router.push('/signup')}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-7 py-3.5 text-lg font-semibold text-white shadow-md transition hover:bg-primary-700"
            >
              Start free trial
              <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => router.push('/book-demo')}
              className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary-600 bg-white px-7 py-3.5 text-lg font-semibold text-primary-600 transition hover:bg-slate-50"
            >
              Book a demo
            </button>
            <button
              type="button"
              onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center justify-center rounded-xl px-2 py-3 text-lg font-medium text-slate-600 underline-offset-4 hover:text-primary-600 hover:underline"
            >
              See pricing
            </button>
          </div>
          <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
            <Shield className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
            No credit card to start · Works on phone & computer
          </p>
        </div>

        {/* Product mockup — abstract invoice UI, neutral surfaces per design tokens */}
        <div className="relative mx-auto w-full max-w-lg lg:max-w-none 2xl:min-w-0">
          <div
            className="absolute -inset-3 rounded-3xl bg-slate-200/40 blur-2xl"
            aria-hidden
          />
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              </div>
              <p className="text-xs font-medium text-slate-500">Khatario · New sale</p>
              <div className="w-8" />
            </div>
            <div className="space-y-4 p-5 sm:p-6 2xl:p-8 2xl:space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer</p>
                <p className="text-lg font-semibold text-slate-900 2xl:text-xl">Sharma & Sons</p>
                <p className="text-sm text-slate-500 2xl:text-base">+91 98xxx xxxxx · Local · GST 09ABCDE1FGH2J5</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/80">
                <div className="grid grid-cols-12 gap-x-1 gap-y-1 border-b border-slate-200 px-2 py-2 text-[11px] font-medium leading-tight text-slate-500 sm:gap-x-2 sm:px-3 sm:text-xs">
                  <span className="col-span-4 sm:col-span-4">Item</span>
                  <span className="col-span-2 text-center sm:text-center">HSN</span>
                  <span className="col-span-2 text-right">GST%</span>
                  <span className="col-span-1 text-right">Qty</span>
                  <span className="col-span-3 text-right">Amount</span>
                </div>
                <div className="divide-y divide-slate-100">
                  <div className="grid grid-cols-12 items-center gap-x-1 px-2 py-2 text-[13px] leading-snug sm:gap-x-2 sm:px-3 sm:text-sm">
                    <span className="col-span-4 min-w-0 truncate text-slate-800 sm:whitespace-normal sm:break-words">
                      Basmathi rice 5kg
                    </span>
                    <span className="col-span-2 text-center tabular-nums text-slate-600">10063030</span>
                    <span className="col-span-2 text-right tabular-nums text-slate-600">5%</span>
                    <span className="col-span-1 text-right tabular-nums text-slate-600">2</span>
                    <span className="col-span-3 text-right font-medium tabular-nums text-slate-900">₹1,180</span>
                  </div>
                  <div className="grid grid-cols-12 items-center gap-x-1 px-2 py-2 text-[13px] leading-snug sm:gap-x-2 sm:px-3 sm:text-sm">
                    <span className="col-span-4 min-w-0 truncate text-slate-800 sm:whitespace-normal sm:break-words">
                      Groundnut oil 1L
                    </span>
                    <span className="col-span-2 text-center tabular-nums text-slate-600">15179090</span>
                    <span className="col-span-2 text-right tabular-nums text-slate-600">18%</span>
                    <span className="col-span-1 text-right tabular-nums text-slate-600">1</span>
                    <span className="col-span-3 text-right font-medium tabular-nums text-slate-900">₹185</span>
                  </div>
                </div>
                <div className="space-y-1.5 border-t border-slate-200 bg-white px-3 py-3 text-sm">
                  {/* Amount column is GST-inclusive; taxable + CGST+SGST split per line rate then summed */}
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable value</span>
                    <span className="tabular-nums">₹1,280.59</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>CGST + SGST</span>
                    <span className="tabular-nums">₹84.41</span>
                  </div>
                  <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold text-slate-900">
                    <span>Total</span>
                    <span className="tabular-nums">₹1,365</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 ring-1 ring-inset ring-green-200">
                  Bill ready
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                  WhatsApp share
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-200">
                  Print · 80mm
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
