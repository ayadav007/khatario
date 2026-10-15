'use client';

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFinalCta } from '@/components/marketing/landing/LandingFinalCta';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { LandingHero } from '@/components/marketing/landing/LandingHero';
import { LandingFaq } from '@/components/marketing/landing/LandingFaq';
import { LandingTemplateGallery } from '@/components/marketing/landing/LandingTemplateGallery';
import { LandingPricing } from '@/components/marketing/landing/LandingPricing';
import { LandingSocialProof } from '@/components/marketing/landing/LandingSocialProof';
import { LandingWalkthrough } from '@/components/marketing/landing/LandingWalkthrough';
import { LandingFeatureBento } from '@/components/marketing/landing/LandingFeatureBento';
import { LandingWhatsAppBand } from '@/components/marketing/landing/LandingWhatsAppBand';
import { LandingPrintLanguages } from '@/components/marketing/landing/LandingPrintLanguages';
import { LandingStaffApp } from '@/components/marketing/landing/LandingStaffApp';
import { LandingTestimonials } from '@/components/marketing/landing/LandingTestimonials';
import { LandingScrollTrialModal } from '@/components/marketing/landing/LandingScrollTrialModal';
import { LandingScrollProgress } from '@/components/marketing/landing/LandingScrollProgress';
import { LandingMobileCta } from '@/components/marketing/landing/LandingMobileCta';
import { LandingPlansProvider } from '@/components/marketing/landing/LandingPlansContext';
import {
  LandingProductProvider,
  readProductLineFromSearchParam,
} from '@/components/marketing/landing/LandingProductContext';
import { MarketingPageRenderer } from '@/components/marketing/builder/MarketingPageRenderer';
import { AssistantWidget } from '@/components/assistant/AssistantWidget';
import type { MarketingDocument } from '@/lib/marketing-builder/sanitize';
import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

/** The coded home page; also the fallback whenever nothing has been published from the Site Builder. */
export function LandingDefaultSections() {
  return (
    <>
      <LandingHero />
      <LandingSocialProof />
      <LandingWalkthrough />
      <LandingFeatureBento />
      <LandingWhatsAppBand />
      <LandingTemplateGallery />
      <LandingPrintLanguages />
      <LandingStaffApp />
      <LandingTestimonials />
      <LandingPricing />
      <LandingFaq />
      <LandingFinalCta />
    </>
  );
}

function LandingShell({
  children,
  previewBanner,
  pricingCatalog,
}: {
  children: ReactNode;
  previewBanner?: boolean;
  pricingCatalog?: PricingCatalog | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [isNativeApp] = useState(() => isCapacitorNative());
  const initialProductLine = readProductLineFromSearchParam(searchParams.get('product'));

  useEffect(() => {
    if (!isNativeApp || authLoading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [isNativeApp, authLoading, user, router]);

  if (isNativeApp) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" aria-label="Loading" />
      </div>
    );
  }

  return (
    <LandingProductProvider initialProductLine={initialProductLine}>
      <LandingPlansProvider initialCatalog={pricingCatalog}>
        <div className="min-h-screen bg-white pb-20 md:pb-0">
          {previewBanner && (
            <div className="sticky top-0 z-[60] bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950">
              Draft preview — visitors still see the published page.
            </div>
          )}
          <LandingScrollProgress />
          <MarketingSiteHeader />
          {children}
          <LandingFooter />
          <LandingScrollTrialModal />
          <LandingMobileCta />
          {!previewBanner ? <AssistantWidget channel="web" mobileBottomOffset={72} /> : null}
        </div>
      </LandingPlansProvider>
    </LandingProductProvider>
  );
}

export function LandingPage({
  document,
  preview = false,
  pricingCatalog = null,
}: {
  document?: MarketingDocument | null;
  preview?: boolean;
  /** Server-loaded plan matrix for the pricing section; fetched in the browser when absent. */
  pricingCatalog?: PricingCatalog | null;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-label="Loading" />
        </div>
      }
    >
      <LandingShell previewBanner={preview} pricingCatalog={pricingCatalog}>
        {document ? <MarketingPageRenderer data={document} /> : <LandingDefaultSections />}
      </LandingShell>
    </Suspense>
  );
}
