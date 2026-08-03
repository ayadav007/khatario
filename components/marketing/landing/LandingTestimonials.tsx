'use client';

import { clsx } from 'clsx';
import { ChevronLeft, ChevronRight, Quote } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  LANDING_INTRO_SUBTEXT,
  LANDING_MAX_WIDE,
  LANDING_PAGE_GUTTER,
  LANDING_SECTION_INTRO,
} from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

const QUOTES = [
  {
    quote:
      'Earlier our evening went into rewriting bills. Now the same person at the counter finishes billing before the next customer shouts the next item. GST figures match what we actually charged.',
    name: 'Priya Nair',
    role: 'Grocery & staples · Kochi',
    result: '~40% faster checkouts on busy days',
  },
  {
    quote:
      'We send WhatsApp bills from the same screen. Payment follow-ups are not “we will do it when free” — they happen from the app.',
    name: 'Harish Bhatt',
    role: 'Electricals & fittings · Indore',
    result: 'Fewer follow-up calls, clearer credit',
  },
  {
    quote:
      'I did not want another “enterprise” tool. Khatario looked like my shop, not a bank dashboard. Reports for my CA take minutes now.',
    name: 'Sulekha R.',
    role: 'Uniform & school supplies · Coimbatore',
    result: 'More time in the store, not in files',
  },
] as const;

const AUTO_MS = 6500;

export function LandingTestimonials() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + QUOTES.length) % QUOTES.length);
  }, []);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % QUOTES.length);
  }, []);

  useEffect(() => {
    if (reduced || paused) return;
    const id = window.setInterval(next, AUTO_MS);
    return () => window.clearInterval(id);
  }, [reduced, paused, next]);

  const t = QUOTES[index];

  return (
    <section className="border-t border-slate-200/80 bg-slate-50/90 py-20 2xl:py-24">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">
              What business owners say
            </h2>
            <p className={LANDING_INTRO_SUBTEXT}>
              The themes below are <strong className="font-medium text-slate-800">typical of what we hear</strong>{' '}
              from shop and warehouse teams after they move day-to-day billing off paper and random WhatsApp math.
            </p>
          </div>
        </LandingReveal>

        <LandingReveal delay={100}>
          <div
            className={`relative mt-12 w-full 2xl:mt-14 ${LANDING_MAX_WIDE}`}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <blockquote
              key={index}
              className="landing-testimonial-fade-in relative rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10 2xl:p-12 2xl:shadow"
            >
              <Quote
                className="absolute right-6 top-6 h-10 w-10 text-slate-100 sm:right-8 sm:top-8"
                aria-hidden
              />
              <p className="relative max-w-3xl text-lg leading-relaxed text-slate-700 sm:text-xl 2xl:text-[1.35rem] 2xl:leading-relaxed">
                “{t.quote}”
              </p>
              <footer className="relative mt-8 flex flex-wrap items-end justify-between gap-4 border-t border-slate-100 pt-6">
                <div>
                  <p className="font-semibold text-slate-900 2xl:text-lg">{t.name}</p>
                  <p className="text-sm text-slate-500 2xl:text-base">{t.role}</p>
                </div>
                <p className="text-sm font-semibold text-green-800 2xl:text-base">{t.result}</p>
              </footer>
            </blockquote>

            <div className="mt-6 flex items-center justify-between gap-4">
              <div className="flex gap-2">
                {QUOTES.map((q, i) => (
                  <button
                    key={q.name}
                    type="button"
                    onClick={() => setIndex(i)}
                    className={clsx(
                      'h-2 rounded-full transition-all duration-300',
                      i === index ? 'w-7 bg-slate-800' : 'w-2 bg-slate-300 hover:bg-slate-400',
                    )}
                    aria-label={`Show testimonial from ${q.name}`}
                    aria-current={i === index}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={prev}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
                  aria-label="Previous testimonial"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50"
                  aria-label="Next testimonial"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}
