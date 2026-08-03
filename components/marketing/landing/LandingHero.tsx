'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, BadgeCheck, MapPin, Shield } from 'lucide-react';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { LANDING_HERO_COPY, type ProductLine } from '@/lib/product-lines';
import { LandingHeroMockup } from '@/components/marketing/landing/LandingHeroMockup';
import { LandingReveal } from '@/components/marketing/landing/LandingReveal';
import { LandingTrustBar } from '@/components/marketing/landing/LandingTrustBar';
import { LandingCrossfade } from '@/components/marketing/landing/LandingCrossfade';
import { LandingHeroHeadline } from '@/components/marketing/landing/LandingHeroHeadline';

function HeroCopyBlock({ productLine }: { productLine: ProductLine }) {
  const heroCopy = LANDING_HERO_COPY[productLine];

  return (
    <>
      <p className="mb-4 inline-flex flex-wrap items-center gap-2 text-sm font-medium text-slate-600">
        {heroCopy.badges.map((badge, index) => (
          <span
            key={badge}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            {index === 0 ? (
              <BadgeCheck className="h-4 w-4 text-green-600" aria-hidden />
            ) : (
              <MapPin className="h-4 w-4 text-slate-500" aria-hidden />
            )}
            {badge}
          </span>
        ))}
      </p>

      <LandingHeroHeadline productLine={productLine} />

      <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600 sm:text-xl xl:max-w-2xl 2xl:max-w-3xl 2xl:text-[1.35rem] 2xl:leading-relaxed">
        {heroCopy.subhead}
      </p>

      <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
        <Shield className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        {heroCopy.footnote}
      </p>
    </>
  );
}

export function LandingHero() {
  const router = useRouter();
  const { productLine, signupHref } = useLandingProduct();

  return (
    <section
      id="landing-hero"
      className={`${LANDING_PAGE_GUTTER} scroll-mt-28 border-b border-slate-200/80 bg-gradient-to-b from-slate-50 via-white to-slate-50/80 py-16 md:py-20 lg:py-24 2xl:py-28`}
    >
      <div className="grid w-full items-center gap-12 lg:grid-cols-2 lg:gap-16 xl:gap-20 2xl:gap-24">
        <div className="text-left">
          <LandingReveal delay={0}>
            <LandingCrossfade contentKey={productLine} className="space-y-0">
              {(line) => <HeroCopyBlock productLine={line} />}
            </LandingCrossfade>
            <LandingTrustBar />
          </LandingReveal>

          <LandingReveal delay={240}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => router.push(signupHref)}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 px-7 py-3.5 text-lg font-semibold text-white shadow-md transition hover:bg-primary-700 hover:shadow-lg"
              >
                <LandingCrossfade contentKey={productLine} className="inline-flex items-center gap-2">
                  {(line) => (
                    <>
                      {LANDING_HERO_COPY[line].cta}
                      <ArrowRight
                        className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </>
                  )}
                </LandingCrossfade>
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
                onClick={() =>
                  document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })
                }
                className="inline-flex items-center justify-center rounded-xl px-2 py-3 text-lg font-medium text-slate-600 underline-offset-4 hover:text-primary-600 hover:underline"
              >
                See pricing
              </button>
            </div>
          </LandingReveal>
        </div>

        <LandingReveal delay={180}>
          <LandingHeroMockup productLine={productLine} />
        </LandingReveal>
      </div>
    </section>
  );
}
