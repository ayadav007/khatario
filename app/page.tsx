'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import { MarketingSiteHeader } from '@/components/marketing/MarketingSiteHeader';
import { LandingFinalCta } from '@/components/marketing/landing/LandingFinalCta';
import { LandingFooter } from '@/components/marketing/landing/LandingFooter';
import { LandingHero } from '@/components/marketing/landing/LandingHero';
import { LandingKeyFeatures } from '@/components/marketing/landing/LandingKeyFeatures';
import { LandingComparison } from '@/components/marketing/landing/LandingComparison';
import { LandingPricing, type LandingPricingPlan } from '@/components/marketing/landing/LandingPricing';
import { LandingProblemSolution } from '@/components/marketing/landing/LandingProblemSolution';
import { LandingScenarios } from '@/components/marketing/landing/LandingScenarios';
import { LandingConnectedSupply } from '@/components/marketing/landing/LandingConnectedSupply';
import { LandingSocialProof } from '@/components/marketing/landing/LandingSocialProof';
import { LandingTestimonials } from '@/components/marketing/landing/LandingTestimonials';
import { LandingTrustStrip } from '@/components/marketing/landing/LandingTrustStrip';
import { LandingWalkthrough } from '@/components/marketing/landing/LandingWalkthrough';
import { LandingWhoItsFor } from '@/components/marketing/landing/LandingWhoItsFor';
import { LandingScrollTrialModal } from '@/components/marketing/landing/LandingScrollTrialModal';
import { LandingProductPicker } from '@/components/marketing/landing/LandingProductPicker';
import { LandingScrollProgress } from '@/components/marketing/landing/LandingScrollProgress';
import { LandingMobileCta } from '@/components/marketing/landing/LandingMobileCta';
import {
  LandingProductProvider,
  readProductLineFromSearchParam,
} from '@/components/marketing/landing/LandingProductContext';

function LandingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [isNativeApp] = useState(() => isCapacitorNative());
  const [plans, setPlans] = useState<LandingPricingPlan[]>([]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(true);
  const initialProductLine = readProductLineFromSearchParam(searchParams.get('product'));

  useEffect(() => {
    if (!isNativeApp || authLoading) return;
    router.replace(user ? '/dashboard' : '/login');
  }, [isNativeApp, authLoading, user, router]);

  useEffect(() => {
    if (isNativeApp) return;
    void fetchPlans();
  }, [isNativeApp]);

  async function fetchPlans() {
    try {
      const response = await fetch('/api/admin/subscriptions/plans');
      const data = await response.json();
      setPlans(data.plans || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
    } finally {
      setLoading(false);
    }
  }

  if (isNativeApp) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" aria-label="Loading" />
      </div>
    );
  }

  return (
    <LandingProductProvider initialProductLine={initialProductLine}>
      <div className="min-h-screen bg-white pb-20 md:pb-0">
        <LandingScrollProgress />
        <MarketingSiteHeader />

        <LandingProductPicker />
        <LandingHero />
        <LandingSocialProof />
        <LandingConnectedSupply />
        <LandingProblemSolution />
        <LandingWhoItsFor />
        <LandingScenarios />
        <LandingWalkthrough />
        <LandingKeyFeatures />
        <LandingComparison />
        <LandingTestimonials />
        <LandingTrustStrip />
        <LandingPricing
          plans={plans}
          loading={loading}
          billingCycle={billingCycle}
          onBillingCycle={setBillingCycle}
        />
        <LandingFinalCta />
        <LandingFooter />
        <LandingScrollTrialModal />
        <LandingMobileCta />
      </div>
    </LandingProductProvider>
  );
}

export default function LandingPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-label="Loading" />
        </div>
      }
    >
      <LandingPageContent />
    </Suspense>
  );
}
