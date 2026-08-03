'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useLandingProduct } from '@/components/marketing/landing/LandingProductContext';
import { LANDING_HERO_COPY } from '@/lib/product-lines';

/** Sticky trial CTA on small screens — keeps conversion one tap away while scrolling. */
export function LandingMobileCta() {
  const router = useRouter();
  const { productLine, signupHref } = useLandingProduct();
  const heroCopy = LANDING_HERO_COPY[productLine];

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-4px_24px_rgba(15,23,42,0.08)] backdrop-blur-md md:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        onClick={() => router.push(signupHref)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3.5 text-base font-semibold text-white shadow-md transition active:scale-[0.98]"
      >
        {heroCopy.cta}
        <ArrowRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}
