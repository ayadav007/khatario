'use client';

import { clsx } from 'clsx';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { LANDING_INTRO_SUBTEXT, LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { useInViewOnce } from '@/hooks/useInViewOnce';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { useMarketingEditing } from '@/components/marketing/builder/MarketingEditingContext';
import { withDefaults } from '@/lib/marketing-builder/merge';
import { DOCUMENT_LANGUAGES, printFontStack, type DocumentLanguage } from '@/lib/print-language/codes';
import { translateLabelKey } from '@/lib/print-language/labels';
import { amountInWords } from '@/lib/print-language/amount';

export type LandingPrintLanguagesContent = {
  kicker: string;
  heading: string;
  subtext: string;
};

export const LANDING_PRINT_LANGUAGES_DEFAULTS: LandingPrintLanguagesContent = {
  kicker: 'Print languages',
  heading: "Bills in your customer's language.",
  subtext: 'Headings and the amount in words print in the script you choose, per business or per customer.',
};

const SAMPLE_ROWS = [
  ['Basmati Rice 5kg × 4', '2,478.00'],
  ['Toor Dal 1kg × 10', '1,732.50'],
  ['Sunflower Oil 1L × 6', '913.50'],
  ['Detergent Powder 1kg × 5', '973.50'],
] as const;
const SAMPLE_TOTAL = 6098;
const ROTATE_MS = 2200;

/** Hindi first so the first thing visitors see is a non-English bill. */
const ORDERED: DocumentLanguage[] = ['hi', ...DOCUMENT_LANGUAGES.map((l) => l.code).filter((c) => c !== 'hi')];

export function LandingPrintLanguages(props: Partial<LandingPrintLanguagesContent> = {}) {
  const c = withDefaults(LANDING_PRINT_LANGUAGES_DEFAULTS, props);
  const reduced = usePrefersReducedMotion();
  const editing = useMarketingEditing();
  const { ref, inView } = useInViewOnce({ threshold: 0.3 });
  const [lang, setLang] = useState<DocumentLanguage>('hi');
  const [auto, setAuto] = useState(true);

  const languages = useMemo(
    () => ORDERED.map((code) => ({ code, label: DOCUMENT_LANGUAGES.find((l) => l.code === code)?.label ?? code })),
    [],
  );

  useEffect(() => {
    if (!auto || reduced || editing || !inView) return;
    const id = window.setInterval(() => {
      setLang((cur) => ORDERED[(ORDERED.indexOf(cur) + 1) % ORDERED.length]);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [auto, reduced, editing, inView]);

  const font = printFontStack(lang) ?? undefined;
  const dir = lang === 'ur' ? 'rtl' : undefined;

  return (
    <section id="languages" className="scroll-mt-24 bg-white py-20 2xl:py-28">
      <div className={LANDING_PAGE_GUTTER}>
        <LandingReveal className={LANDING_SECTION_INTRO}>
          {c.kicker && <p className="landing-kicker">{c.kicker}</p>}
          <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl 2xl:text-5xl">{c.heading}</h2>
          {c.subtext && <p className={LANDING_INTRO_SUBTEXT}>{c.subtext}</p>}
        </LandingReveal>

        <div ref={ref as RefObject<HTMLDivElement>} className="mt-12 grid items-center gap-12 lg:grid-cols-[1fr_1.1fr]">
          <LandingReveal>
            <div className="-rotate-1 rounded-lg border border-slate-200 bg-white p-6 shadow-2xl shadow-primary-900/15 transition-transform duration-500 hover:rotate-0 sm:p-8" aria-live="polite">
              <div className="flex items-baseline justify-between gap-4 border-b-2 border-slate-900 pb-3">
                <p key={lang} className="landing-testimonial-fade-in text-2xl font-bold text-primary-600 sm:text-3xl" style={{ fontFamily: font }} dir={dir}>
                  {translateLabelKey(lang, 'tax_invoice')}
                </p>
                <span className="text-xs text-slate-500">INV-0142</span>
              </div>
              <div className="mt-2 text-sm tabular-nums">
                {SAMPLE_ROWS.map(([item, amt]) => (
                  <div key={item} className="flex justify-between border-b border-dashed border-slate-200 py-2">
                    <span className="text-slate-700">{item}</span>
                    <span>{amt}</span>
                  </div>
                ))}
                <div className="flex justify-between py-2 text-base font-extrabold">
                  <span style={{ fontFamily: font }} dir={dir}>
                    {translateLabelKey(lang, 'grand_total')}
                  </span>
                  <span>₹{SAMPLE_TOTAL.toLocaleString('en-IN')}.00</span>
                </div>
                <p key={`${lang}-words`} className="landing-testimonial-fade-in mt-1 text-xs text-slate-500" style={{ fontFamily: font }} dir={dir}>
                  {amountInWords(SAMPLE_TOTAL, lang)}
                </p>
              </div>
            </div>
          </LandingReveal>

          <LandingReveal delay={100}>
            <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Choose a print language">
              {languages.map(({ code, label }) => {
                const selected = code === lang;
                return (
                  <button
                    key={code}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setAuto(false);
                      setLang(code);
                    }}
                    className={clsx(
                      'flex flex-col rounded-xl border px-3.5 py-2.5 text-left transition duration-200 hover:-translate-y-0.5',
                      selected ? 'border-primary-600 bg-primary-600 text-white shadow-lg' : 'border-slate-200 bg-white hover:border-primary-600',
                    )}
                  >
                    <span
                      className={clsx('text-base font-bold', selected ? 'text-white' : 'text-primary-600')}
                      style={{ fontFamily: printFontStack(code) ?? undefined }}
                      dir={code === 'ur' ? 'rtl' : undefined}
                    >
                      {translateLabelKey(code, 'tax_invoice')}
                    </span>
                    <span className={clsx('text-xs', selected ? 'text-primary-100' : 'text-slate-500')}>{label}</span>
                  </button>
                );
              })}
            </div>
          </LandingReveal>
        </div>
      </div>
    </section>
  );
}
