'use client';

import { useSearchParams } from 'next/navigation';
import { LandingPricing } from '@/components/marketing/landing/LandingPricing';
import { LandingPlansProvider } from '@/components/marketing/landing/LandingPlansContext';
import {
  LandingProductProvider,
  readProductLineFromSearchParam,
} from '@/components/marketing/landing/LandingProductContext';
import type { ProductLine } from '@/lib/product-lines';
import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

/** The home page pricing section with the live plan catalogue. Reads no search params, so it can render on the server. */
export function PricingPlans({
  pricingCatalog,
  initialProductLine,
}: {
  pricingCatalog: PricingCatalog | null;
  initialProductLine: ProductLine;
}) {
  return (
    <LandingProductProvider initialProductLine={initialProductLine}>
      <LandingPlansProvider initialCatalog={pricingCatalog}>
        <LandingPricing />
      </LandingPlansProvider>
    </LandingProductProvider>
  );
}

/** `?product=` picks the product line once the browser has the URL. */
export function PricingPageBody({ pricingCatalog }: { pricingCatalog: PricingCatalog | null }) {
  const searchParams = useSearchParams();
  const initialProductLine = readProductLineFromSearchParam(searchParams.get('product'));
  return <PricingPlans pricingCatalog={pricingCatalog} initialProductLine={initialProductLine} />;
}
