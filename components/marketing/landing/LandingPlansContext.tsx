'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LandingPricingPlan } from '@/components/marketing/landing/LandingPricing';

type LandingPlansValue = {
  plans: LandingPricingPlan[];
  loading: boolean;
  billingCycle: 'monthly' | 'yearly';
  setBillingCycle: (c: 'monthly' | 'yearly') => void;
};

const LandingPlansContext = createContext<LandingPlansValue | null>(null);

export function LandingPlansProvider({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const [plans, setPlans] = useState<LandingPricingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/subscriptions/plans');
        const data = await response.json();
        if (!cancelled) setPlans(data.plans || []);
      } catch (error) {
        console.error('Error fetching plans:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const value = useMemo(
    () => ({ plans, loading, billingCycle, setBillingCycle }),
    [plans, loading, billingCycle],
  );
  return <LandingPlansContext.Provider value={value}>{children}</LandingPlansContext.Provider>;
}

export function useLandingPlans(): LandingPlansValue {
  const ctx = useContext(LandingPlansContext);
  if (!ctx) return { plans: [], loading: false, billingCycle: 'monthly', setBillingCycle: () => {} };
  return ctx;
}
