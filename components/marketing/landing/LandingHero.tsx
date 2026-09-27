'use client';

import Link from 'next/link';
import { ArrowRight, BadgeCheck, MapPin, Shield } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { LANDING_HERO_COPY, type ProductLine } from '@/lib/product-lines';
import { LandingHeroMockup } from '@/components/marketing/landing/LandingHeroMockup';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import {
  DEFAULT_TRUST_ITEMS,
  LandingTrustBar,
  type TrustBarItem,
} from '@/components/marketing/landing/LandingTrustBar';
import { LandingCrossfade } from '@/components/marketing/landing/LandingCrossfade';
import {
  DEFAULT_BILLING_HEADLINE,
  LandingHeroHeadline,
} from '@/components/marketing/landing/LandingHeroHeadline';
import { LandingProductToggle } from '@/components/marketing/landing/LandingProductToggle';
import { MarketingImg } from '@/components/marketing/builder/MarketingImg';
import { withDefaults } from '@/lib/marketing-builder/merge';

/** Editable copy for the Billing product. HR and Connect keep their built-in copy. */
export type LandingHeroContent = {
  showProductToggle: boolean;
  badges: { text: string }[];
  headlineLead: string;
  headlineAccent: string;
  rotatingWords: { word: string }[];
  headlineTail: string;
  subhead: string;
  footnote: string;
  trustItems: TrustBarItem[];
  primaryCta: string;
  secondaryLabel: string;
  secondaryHref: string;
  tertiaryLabel: string;
  tertiaryHref: string;
  visual: 'mockup' | 'image';
  image: string;
  imageAlt: string;
};

const billingCopy = LANDING_HERO_COPY.billing;

export const LANDING_HERO_DEFAULTS: LandingHeroContent = {
  showProductToggle: true,
  badges: billingCopy.badges.map((text) => ({ text })),
  headlineLead: DEFAULT_BILLING_HEADLINE.lead,
  headlineAccent: DEFAULT_BILLING_HEADLINE.accent,
  rotatingWords: DEFAULT_BILLING_HEADLINE.words.map((word) => ({ word })),
  headlineTail: DEFAULT_BILLING_HEADLINE.tail,
  subhead: billingCopy.subhead,
  footnote: billingCopy.footnote,
  trustItems: DEFAULT_TRUST_ITEMS,
  primaryCta: billingCopy.cta,
  secondaryLabel: 'Book a demo',
  secondaryHref: '/book-demo',
  tertiaryLabel: 'See pricing',
  tertiaryHref: '#pricing',
  visual: 'mockup',
  image: '',
  imageAlt: '',
};

type HeroText = { badges: string[]; subhead: string; footnote: string; cta: string };

function heroText(line: ProductLine, c: LandingHeroContent): HeroText {
  if (line !== 'billing') return LANDING_HERO_COPY[line];
  return {
    badges: c.badges.map((b) => b.text).filter(Boolean),
    subhead: c.subhead,
    footnote: c.footnote,
    cta: c.primaryCta,
  };
}

function HeroCopyBlock({ productLine, content }: { productLine: ProductLine; content: LandingHeroContent }) {
  const text = heroText(productLine, content);

  return (
    <>
      {text.badges.length > 0 && (
        <p className="mb-4 inline-flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
          {text.badges.map((badge, index) => (
            <span
              key={badge}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              {index === 0 ? (
                <BadgeCheck className="h-4 w-4 text-primary-600" aria-hidden />
              ) : (
                <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
              )}
              {badge}
            </span>
          ))}
        </p>
      )}

      <LandingHeroHeadline
        productLine={productLine}
        billing={{
          lead: content.headlineLead,
          accent: content.headlineAccent,
          words: content.rotatingWords.map((w) => w.word).filter(Boolean),
          tail: content.headlineTail,
        }}
      />

      <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl xl:max-w-2xl 2xl:max-w-3xl 2xl:text-[1.35rem] 2xl:leading-relaxed">
        {text.subhead}
      </p>

      {text.footnote && (
        <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
          <Shield className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          {text.footnote}
        </p>
      )}
    </>
  );
}

function HeroLink({ href, className, children }: { href: string; className: string; children: React.ReactNode }) {
  if (href.startsWith('#')) {
    return (
      <a
        href={href}
        className={className}
        onClick={(e) => {
          const target = document.getElementById(href.slice(1));
          if (!target) return;
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function LandingHero(props: Partial<LandingHeroContent> = {}) {
  const content = withDefaults(LANDING_HERO_DEFAULTS, props);
  const { productLine, signupHref } = useLandingProduct();

  return (
    <section
      id="landing-hero"
      className={`${LANDING_PAGE_GUTTER} scroll-mt-28 border-b border-slate-200/80 bg-gradient-to-b from-slate-50 via-white to-slate-50/80 py-10 md:py-16 lg:py-20 2xl:py-24`}
    >
      <div className="grid w-full items-center gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-20 2xl:gap-24">
        <div className="text-left">
          {content.showProductToggle && <LandingProductToggle className="mb-6" />}
          <LandingReveal delay={0}>
            <LandingCrossfade contentKey={productLine}>
              {(line) => <HeroCopyBlock productLine={line} content={content} />}
            </LandingCrossfade>
            <LandingTrustBar items={content.trustItems} />
          </LandingReveal>

          <LandingReveal delay={240}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                href={signupHref}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-7 py-3.5 text-lg font-semibold text-white shadow-md transition hover:bg-primary-700 hover:shadow-lg"
              >
                <LandingCrossfade contentKey={productLine} className="inline-flex items-center gap-2">
                  {(line) => (
                    <>
                      {heroText(line, content).cta}
                      <ArrowRight
                        className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </>
                  )}
                </LandingCrossfade>
              </Link>
              {content.secondaryLabel && (
                <HeroLink
                  href={content.secondaryHref || '/book-demo'}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border-2 border-primary-600 bg-white px-7 py-3.5 text-lg font-semibold text-primary-600 transition hover:bg-slate-50"
                >
                  {content.secondaryLabel}
                </HeroLink>
              )}
              {content.tertiaryLabel && (
                <HeroLink
                  href={content.tertiaryHref || '#pricing'}
                  className="inline-flex items-center justify-center rounded-xl px-2 py-3 text-lg font-medium text-slate-600 underline-offset-4 hover:text-primary-600 hover:underline"
                >
                  {content.tertiaryLabel}
                </HeroLink>
              )}
            </div>
          </LandingReveal>
        </div>

        <LandingReveal delay={180}>
          {content.visual === 'image' && content.image ? (
            <MarketingImg
              src={content.image}
              alt={content.imageAlt}
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="rounded-2xl shadow-2xl shadow-slate-900/10"
            />
          ) : (
            <LandingHeroMockup productLine={productLine} />
          )}
        </LandingReveal>
      </div>
    </section>
  );
}
