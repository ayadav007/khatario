'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LANDING_HERO_COPY } from '@/lib/product-lines';
import type { ProductLine } from '@/lib/product-lines';

const HERO_ROTATE_WORDS = ['calmer', 'simpler'] as const;
const LONGEST_HERO_WORD = [...HERO_ROTATE_WORDS].sort((a, b) => b.length - a.length)[0];
const HERO_ROTATE_MS = 3600;
const HERO_EXIT_MS = 420;
const HERO_ENTER_MS = 480;

type HeroWordAnim = 'idle' | 'exit' | 'enter';

function BillingAnimatedHeadline() {
  const [heroWordIdx, setHeroWordIdx] = useState(0);
  const [reduceHeroMotion, setReduceHeroMotion] = useState(false);
  const [heroWordAnim, setHeroWordAnim] = useState<HeroWordAnim>('idle');
  const heroCycleTimersRef = useRef<{ exit?: number; enter?: number }>({});
  const heroGhostMeasureRef = useRef<HTMLSpanElement>(null);
  const [heroSlotPx, setHeroSlotPx] = useState(0);
  const rotatingWord = HERO_ROTATE_WORDS[heroWordIdx];

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceHeroMotion(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!reduceHeroMotion) return;
    const id = window.setInterval(() => {
      setHeroWordIdx((i) => (i + 1) % HERO_ROTATE_WORDS.length);
    }, HERO_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduceHeroMotion]);

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
    <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[2.75rem] xl:text-[3.25rem] 2xl:text-[3.5rem] 2xl:leading-[1.08]">
      Still billing by hand at closing time?{' '}
      <span className="inline-flex flex-wrap items-baseline gap-x-1">
        <span className="whitespace-nowrap text-primary-600">There is a</span>
        <span
          className="relative inline-flex shrink-0 justify-end pb-0.5 align-baseline text-accent-600"
          style={{ width: heroSlotPx > 0 ? heroSlotPx : undefined }}
        >
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
        <span className="whitespace-nowrap text-primary-600">way.</span>
      </span>
    </h1>
  );
}

export function LandingHeroHeadline({ productLine }: { productLine: ProductLine }) {
  if (productLine === 'billing') {
    return <BillingAnimatedHeadline />;
  }

  return (
    <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl lg:text-[2.75rem] xl:text-[3.25rem] 2xl:text-[3.5rem] 2xl:leading-[1.08]">
      {LANDING_HERO_COPY[productLine].headline}
    </h1>
  );
}
