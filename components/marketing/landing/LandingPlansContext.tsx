'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PricingCatalog } from '@/lib/subscription/pricing-catalog';

export type BillingCycle = 'monthly' | 'yearly' | 'three_year';

type LandingPlansValue = {
  catalog: PricingCatalog | null;
  loading: boolean;
  billingCycle: BillingCycle;
  setBillingCycle: (c: BillingCycle) => void;
};

const LandingPlansContext = createContext<LandingPlansValue | null>(null);

/** Pricing catalog for the landing page: server-loaded when available, otherwise fetched from the public API. */
export function LandingPlansProvider({
  enabled = true,
  initialCatalog = null,
  children,
}: {
  enabled?: boolean;
  initialCatalog?: PricingCatalog | null;
  children: ReactNode;
}) {
  const [catalog, setCatalog] = useState<PricingCatalog | null>(initialCatalog);
  const [loading, setLoading] = useState(!initialCatalog);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  useEffect(() => {
    if (!enabled || initialCatalog) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/public/pricing');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as PricingCatalog;
        if (!cancelled) setCatalog(data);
      } catch (error) {
        console.error('Error fetching pricing:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, initialCatalog]);

  const value = useMemo(
    () => ({ catalog, loading, billingCycle, setBillingCycle }),
    [catalog, loading, billingCycle],
  );
  return <LandingPlansContext.Provider value={value}>{children}</LandingPlansContext.Provider>;
}

export function useLandingPlans(): LandingPlansValue {
  const ctx = useContext(LandingPlansContext);
  if (!ctx) return { catalog: null, loading: false, billingCycle: 'monthly', setBillingCycle: () => {} };
  return ctx;
}
