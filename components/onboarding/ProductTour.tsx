'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { driver, type DriveStep, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';
import { WelcomeTourModal } from '@/components/onboarding/WelcomeTourModal';
import { useAuth } from '@/contexts/AuthContext';
import { useLayout } from '@/contexts/LayoutContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { getPosMode } from '@/lib/pos-settings';
import {
  expandProductTourSidebarSections,
  PRODUCT_TOUR_START_EVENT,
  PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY,
} from './productTourShared';
import { useToastContext } from '@/contexts/ToastContext';

function useIsLargeScreen(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setOk(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  return ok;
}

function useBuildTourSteps(hasCapability: (m: string, a?: string) => boolean): DriveStep[] {
  return useMemo(() => {
    const steps: DriveStep[] = [
      {
        element: '[data-tour="nav-dashboard"]',
        popover: {
          title: 'Start from your dashboard',
          description:
            'Your home base for metrics and shortcuts — hop back here any time from the left menu.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="nav-sales"]',
        popover: {
          title: 'Everything you sell',
          description:
            'Customers, invoices, quotes, challans, and credit notes — your full sales workflow in one place.',
          side: 'right',
          align: 'start',
        },
      },
    ];

    if (hasCapability('customers', 'view')) {
      steps.push({
        element: '[data-tour="nav-customers"]',
        popover: {
          title: 'Know your customers',
          description:
            'Keep parties organized, view balances, and pick them fast on invoices and quotes.',
          side: 'right',
          align: 'start',
        },
      });
    }

    if (hasCapability('items', 'view')) {
      steps.push({
        element: '[data-tour="nav-items"]',
        popover: {
          title: 'Your product catalog',
          description: 'Items, prices, and stock defaults — so every bill stays accurate.',
          side: 'right',
          align: 'start',
        },
      });
    }

    if (hasCapability('invoices', 'view')) {
      steps.push({
        element: '[data-tour="nav-invoices"]',
        popover: {
          title: 'Bill with confidence',
          description:
            'GST invoices, proformas, and sales documents — all tied to your catalog and customers.',
          side: 'right',
          align: 'start',
        },
      });
    }

    steps.push({
      element: '[data-tour="nav-reports"]',
      popover: {
        title: 'Insights that matter',
        description:
          'P&L, GST, stock, party statements — start from Overview and dig into the details.',
        side: 'right',
        align: 'start',
      },
    });

    if (hasCapability('settings', 'view')) {
      steps.push({
        element: '[data-tour="nav-settings"]',
        popover: {
          title: 'Make it yours',
          description:
            'Templates, tax, team access, branches, WhatsApp, billing — tune Khatario to how you work.',
          side: 'right',
          align: 'start',
        },
      });
    }

    steps.push({
      element: '[data-tour="nav-help"]',
      popover: {
        title: "We're here for you",
        description:
          'Tips, FAQs, and support — replay the guided tour from Help (Menu & profile, or each part separately) or the sparkles control at the bottom of the sidebar.',
        side: 'right',
        align: 'start',
      },
    });

    return steps;
  }, [hasCapability]);
}

async function patchProductTourComplete(): Promise<void> {
  await fetch('/api/user/product-tour', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ action: 'complete' }),
  });
}

function ProductTourInner() {
  const { user, loading: authLoading, refresh } = useAuth();
  const { snapshotLoaded } = useLayoutData();
  const toast = useToastContext();
  const { setSidebarCollapsed } = useLayout();
  const { hasCapability } = useCapabilityCheck();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const lg = useIsLargeScreen();
  const steps = useBuildTourSteps(hasCapability);

  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const driverRef = useRef<Driver | null>(null);
  /** Tracks a single ?product_tour=start navigation so replay works in the same session */
  const manualStartHandledKey = useRef<string | null>(null);
  const welcomeScheduledRef = useRef(false);
  /** Set when starting tour from Help so delayed welcome never opens */
  const suppressWelcomeRef = useRef(false);
  const completionSavedRef = useRef(false);
  /** After sidebar tour, open Business Profile guided tour (sidebar footer button) */
  const chainBusinessProfileAfterSidebarRef = useRef(false);

  const posBlocking = pathname === '/invoices/new' && getPosMode();

  const persistTourCompletion = useCallback(async () => {
    if (completionSavedRef.current) return;
    completionSavedRef.current = true;
    try {
      await patchProductTourComplete();
      await refresh();
    } catch {
      /* non-blocking */
    }
  }, [refresh]);

  const destroyTour = useCallback(() => {
    try {
      driverRef.current?.destroy();
    } catch {
      /* ignore */
    }
    driverRef.current = null;
  }, []);

  const startSpotlightTour = useCallback(
    (options?: { chainBusinessProfile?: boolean }) => {
      chainBusinessProfileAfterSidebarRef.current = options?.chainBusinessProfile === true;
      completionSavedRef.current = false;
      destroyTour();
      setSidebarCollapsed(false);
      expandProductTourSidebarSections(['Sales', 'Inventory', 'Reports', 'More']);

      window.setTimeout(() => {
        const filtered = steps.filter((s) => {
          const el = s.element;
          if (typeof el === 'string') {
            return document.querySelector(el);
          }
          return true;
        });

        if (filtered.length === 0) {
          chainBusinessProfileAfterSidebarRef.current = false;
          return;
        }

        const d = driver({
          popoverClass: 'khatario-driver-popover',
          showProgress: true,
          progressText: 'Step {{current}} of {{total}}',
          nextBtnText: 'Next',
          prevBtnText: 'Back',
          doneBtnText: 'Done',
          showButtons: ['next', 'previous', 'close'],
          overlayOpacity: 0.42,
          overlayColor: '#1e1b4b',
          stageRadius: 12,
          stagePadding: 6,
          smoothScroll: true,
          animate: true,
          steps: filtered,
          onCloseClick: (_, __, { driver: drv }) => {
            chainBusinessProfileAfterSidebarRef.current = false;
            void persistTourCompletion().finally(() => drv.destroy());
          },
          onDestroyed: () => {
            driverRef.current = null;
            const openBusinessProfile = chainBusinessProfileAfterSidebarRef.current;
            chainBusinessProfileAfterSidebarRef.current = false;
            void persistTourCompletion();
            if (openBusinessProfile) {
              router.push('/settings/business?business_profile_tour=start');
            }
          },
        });

        driverRef.current = d;
        d.drive(0);

        try {
          const active = document.querySelector(
            '[data-tour="nav-dashboard"],[data-tour="nav-sales"],[data-tour="nav-reports"]'
          );
          active?.scrollIntoView({ block: 'nearest' });
        } catch {
          /* ignore */
        }
      }, 420);
    },
    [destroyTour, persistTourCompletion, router, setSidebarCollapsed, steps]
  );

  // Manual start: ?product_tour=start (from Help & Support)
  useEffect(() => {
    if (authLoading || !user || !snapshotLoaded || !lg || posBlocking) return;

    const start = searchParams.get('product_tour');
    if (start !== 'start') {
      manualStartHandledKey.current = null;
      return;
    }

    const path = pathname || '';
    const dedupeKey = `${path}?product_tour=start`;
    if (manualStartHandledKey.current === dedupeKey) return;
    manualStartHandledKey.current = dedupeKey;

    welcomeScheduledRef.current = true;
    suppressWelcomeRef.current = true;
    setWelcomeOpen(false);

    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      u.searchParams.delete('product_tour');
      router.replace(u.pathname + u.search, { scroll: false });
    }
    window.setTimeout(() => {
      let chainProfile = false;
      if (typeof window !== 'undefined') {
        const stored = sessionStorage.getItem(PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY);
        if (stored !== null) {
          sessionStorage.removeItem(PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY);
          chainProfile = stored === '1';
        }
      }
      startSpotlightTour({ chainBusinessProfile: chainProfile });
    }, 400);
  }, [
    authLoading,
    user,
    snapshotLoaded,
    lg,
    posBlocking,
    searchParams,
    pathname,
    router,
    startSpotlightTour,
  ]);

  // First login: welcome modal (DB has no completion)
  useEffect(() => {
    if (authLoading || !user || !snapshotLoaded || !lg || posBlocking) return;
    if (user.product_tour_completed_at) return;
    if (searchParams.get('product_tour') === 'start') return;

    if (welcomeScheduledRef.current) return;
    welcomeScheduledRef.current = true;

    const t = window.setTimeout(() => {
      if (suppressWelcomeRef.current) return;
      setWelcomeOpen(true);
    }, 1200);
    return () => {
      clearTimeout(t);
      /* Allow scheduling again when `user` updates (e.g. session refetch after DB cleared stale cached flag). */
      welcomeScheduledRef.current = false;
    };
  }, [
    authLoading,
    user?.id,
    user?.product_tour_completed_at,
    snapshotLoaded,
    lg,
    posBlocking,
    searchParams,
  ]);

  useEffect(() => {
    return () => {
      /** Cancel “then open business profile” if the user navigates away mid-tour */
      chainBusinessProfileAfterSidebarRef.current = false;
      destroyTour();
    };
  }, [pathname, destroyTour]);

  /** Sidebar footer: sidebar spotlight, optionally then Business Profile tour */
  useEffect(() => {
    const handler = (e: Event) => {
      if (authLoading || !snapshotLoaded || !user) return;
      if (!lg) return;
      if (posBlocking) {
        toast.warning('Turn off POS mode on this invoice page to run the tour.');
        return;
      }
      const detail = (e as CustomEvent<{ chainBusinessProfile?: boolean }>).detail;
      const chainBusinessProfile = detail?.chainBusinessProfile === true;

      /** Settings sub-pages replace the main nav — tour targets are missing; use dashboard first */
      const onSettingsDeepRoute = typeof pathname === 'string' && pathname.startsWith('/settings/');
      if (onSettingsDeepRoute) {
        sessionStorage.setItem(
          PRODUCT_TOUR_CHAIN_PROFILE_SESSION_KEY,
          chainBusinessProfile ? '1' : '0'
        );
        router.push('/dashboard?product_tour=start');
        return;
      }

      startSpotlightTour({ chainBusinessProfile });
    };
    window.addEventListener(PRODUCT_TOUR_START_EVENT, handler);
    return () => window.removeEventListener(PRODUCT_TOUR_START_EVENT, handler);
  }, [
    authLoading,
    snapshotLoaded,
    user,
    lg,
    posBlocking,
    pathname,
    router,
    startSpotlightTour,
    toast,
  ]);

  const onTourBusinessProfile = useCallback(async () => {
    setWelcomeOpen(false);
    suppressWelcomeRef.current = true;
    try {
      await fetch('/api/user/product-tour', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'dismiss' }),
      });
      await refresh();
    } catch {
      /* ignore */
    }
    router.push('/settings/business?business_profile_tour=start');
  }, [router, refresh]);

  const onDismissWelcome = useCallback(async () => {
    setWelcomeOpen(false);
    try {
      await fetch('/api/user/product-tour', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'dismiss' }),
      });
      await refresh();
    } catch {
      /* ignore */
    }
  }, [refresh]);

  const onShowAround = useCallback(() => {
    setWelcomeOpen(false);
    startSpotlightTour();
  }, [startSpotlightTour]);

  if (!lg || posBlocking || authLoading || !user) {
    return null;
  }

  return (
    <>
      {welcomeOpen && (
        <WelcomeTourModal
          userName={user.name}
          onShowAround={onShowAround}
          onDismiss={onDismissWelcome}
          onTourBusinessProfile={onTourBusinessProfile}
        />
      )}
    </>
  );
}

/**
 * Guided sidebar tour (Driver.js). Welcome modal for first-time users; `?product_tour=start` to replay from Help.
 */
export function ProductTour() {
  return (
    <React.Suspense fallback={null}>
      <ProductTourInner />
    </React.Suspense>
  );
}
