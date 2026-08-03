'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Calculator, MessageSquare, UserCheck } from 'lucide-react';
import { clsx } from 'clsx';
import {
  LANDING_HERO_COPY,
  PRODUCT_LINE_DESCRIPTIONS,
  PRODUCT_LINE_LABELS,
  type ProductLine,
} from '@/lib/product-lines';
import { LANDING_PAGE_GUTTER } from '@/lib/marketing-layout';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { scrollLandingAfterProductPick } from '@/lib/marketing/landing-scroll';

const OPTIONS: {
  id: ProductLine;
  icon: typeof Calculator;
  tagline: string;
}[] = [
  {
    id: 'billing',
    icon: Calculator,
    tagline: PRODUCT_LINE_DESCRIPTIONS.billing,
  },
  {
    id: 'hr',
    icon: UserCheck,
    tagline: PRODUCT_LINE_DESCRIPTIONS.hr,
  },
  {
    id: 'connect',
    icon: MessageSquare,
    tagline: PRODUCT_LINE_DESCRIPTIONS.connect,
  },
];

export function LandingProductPicker() {
  const router = useRouter();
  const { productLine, setProductLine, signupHref } = useLandingProduct();
  const heroCopy = LANDING_HERO_COPY[productLine];
  const productLabel = PRODUCT_LINE_LABELS[productLine];

  const handleSelect = (id: ProductLine) => {
    const sameProduct = id === productLine;
    setProductLine(id);
    scrollLandingAfterProductPick({ sameProduct });
  };

  return (
    <section
      className={`${LANDING_PAGE_GUTTER} border-b border-slate-200/80 bg-white py-8 md:py-10`}
      aria-label="Choose your Khatario product"
    >
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          What do you need?
        </p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Pick your product to get started
        </h2>
        <p className="mt-2 text-base text-slate-600">
          Tap a product — hero updates below, then we scroll you to pricing.
        </p>
      </div>

      <div className="mx-auto mt-8 grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-5">
        {OPTIONS.map(({ id, icon: Icon, tagline }) => {
          const selected = productLine === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleSelect(id)}
              aria-pressed={selected}
              className={clsx(
                'flex flex-col items-start rounded-2xl border p-5 text-left transition-all duration-300 sm:p-6',
                selected
                  ? 'scale-[1.02] border-primary-600 bg-slate-50 shadow-md ring-2 ring-primary-600/20'
                  : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50/80 hover:shadow-sm',
              )}
            >
              <span
                className={clsx(
                  'inline-flex h-11 w-11 items-center justify-center rounded-xl',
                  selected ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="mt-4 text-lg font-bold text-slate-900">
                Khatario {PRODUCT_LINE_LABELS[id]}
              </span>
              <span className="mt-2 text-sm leading-relaxed text-slate-600">{tagline}</span>
              {selected && (
                <span className="landing-testimonial-fade-in mt-4 text-xs font-semibold uppercase tracking-wide text-primary-600">
                  Selected · see pricing below
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mx-auto mt-8 flex max-w-5xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => router.push(signupHref)}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-8 py-3.5 text-base font-semibold text-white shadow-md transition hover:bg-primary-700 sm:w-auto"
        >
          {heroCopy.cta}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scrollLandingAfterProductPick({ sameProduct: true })}
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-8 py-3.5 text-base font-semibold text-slate-800 transition hover:bg-slate-50 sm:w-auto"
        >
          See {productLabel} pricing
        </button>
      </div>
    </section>
  );
}
