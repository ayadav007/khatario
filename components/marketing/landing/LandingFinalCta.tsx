'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { LANDING_PAGE_GUTTER, LANDING_SECTION_INTRO } from '@/lib/marketing-layout';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { PRODUCT_LINE_LABELS } from '@/lib/product-lines';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { withDefaults } from '@/lib/marketing-builder/merge';

export type LandingFinalCtaContent = {
  /** `{product}` is replaced with the selected product name (Billing, HR, Connect). */
  heading: string;
  highlight: string;
  subtext: string;
  note: string;
  ctaLabel: string;
};

export const LANDING_FINAL_CTA_DEFAULTS: LandingFinalCtaContent = {
  heading: 'Start with Khatario {product}',
  highlight: 'today',
  subtext: 'Try the full flow on your own data — not a fake demo only.',
  note: 'No credit card required to get started',
  ctaLabel: 'Start free trial',
};

const CONNECT_SUBTEXT = 'No platform fee — add WhatsApp Bot or Send Message when you are ready.';

export function LandingFinalCta(props: Partial<LandingFinalCtaContent> = {}) {
  const c = withDefaults(LANDING_FINAL_CTA_DEFAULTS, props);
  const { productLine, signupHref } = useLandingProduct();
  const heading = c.heading.replace(/\{product\}/g, PRODUCT_LINE_LABELS[productLine]);

  return (
    <section className="relative overflow-hidden bg-slate-900 py-20 2xl:py-28">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(148,163,184,0.15),_transparent_55%)]"
        aria-hidden
      />
      <div className={`${LANDING_PAGE_GUTTER} relative w-full`}>
        <LandingReveal>
          <div className={LANDING_SECTION_INTRO}>
            <h2 className="text-3xl font-bold text-white sm:text-4xl 2xl:text-5xl 2xl:leading-tight">
              {heading}
              {c.highlight && (
                <>
                  {' '}
                  <span className="text-slate-300">{c.highlight}</span>
                </>
              )}
            </h2>
            <p className="mt-4 max-w-3xl text-lg text-slate-300 max-md:mx-auto md:mx-0 2xl:mt-5 2xl:max-w-4xl 2xl:text-xl 2xl:leading-relaxed">
              {productLine === 'connect' ? CONNECT_SUBTEXT : c.subtext}
            </p>
            {c.note && <p className="mt-1 text-sm text-slate-300 2xl:text-base">{c.note}</p>}
            <div className="mt-8 flex max-md:justify-center md:justify-start">
              <Link
                href={signupHref}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-10 py-4 text-lg font-semibold text-white shadow-lg transition hover:bg-primary-700 landing-cta-shimmer"
              >
                {c.ctaLabel}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </div>
          </div>
        </LandingReveal>
      </div>
    </section>
  );
}
