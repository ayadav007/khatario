'use client';

import { useEffect, useState } from 'react';
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

export default function LandingPage() {
  const [plans, setPlans] = useState<LandingPricingPlan[]>([]);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchPlans();
  }, []);

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

  return (
    <div className="min-h-screen bg-white">
      <MarketingSiteHeader />

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
    </div>
  );
}
