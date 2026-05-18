'use client';

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './product-tour.css';
import { BUSINESS_PROFILE_TOUR_STEPS } from '@/components/onboarding/businessProfileTourSteps';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';

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

function startBusinessProfileTour(driverRef: MutableRefObject<Driver | null>) {
  if (typeof window !== 'undefined' && window.location.pathname !== '/settings/business') {
    return;
  }

  try {
    driverRef.current?.destroy();
  } catch {
    /* ignore */
  }
  driverRef.current = null;

  const filtered = BUSINESS_PROFILE_TOUR_STEPS.filter((s) => {
    const el = s.element;
    if (typeof el === 'string') {
      return document.querySelector(el);
    }
    return true;
  });

  if (filtered.length === 0) {
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
      drv.destroy();
    },
    onDestroyed: () => {
      driverRef.current = null;
    },
  });

  driverRef.current = d;
  d.drive(0);

  try {
    const first = filtered[0]?.element;
    if (typeof first === 'string') {
      document.querySelector(first)?.scrollIntoView({ block: 'center' });
    }
  } catch {
    /* ignore */
  }
}

/**
 * URL-driven tour: `/settings/business?business_profile_tour=start`
 * Explains each major block on the business profile screen.
 */
export function BusinessProfileTour() {
  const { user, loading: authLoading } = useAuth();
  const { snapshotLoaded } = useLayoutData();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lg = useIsLargeScreen();
  const driverRef = useRef<Driver | null>(null);
  const handledKeyRef = useRef<string | null>(null);

  const clearQuery = useCallback(() => {
    if (typeof window === 'undefined') return;
    const u = new URL(window.location.href);
    u.searchParams.delete('business_profile_tour');
    router.replace(u.pathname + u.search, { scroll: false });
  }, [router]);

  useEffect(() => {
    return () => {
      try {
        driverRef.current?.destroy();
      } catch {
        /* ignore */
      }
      driverRef.current = null;
    };
  }, [pathname]);

  useEffect(() => {
    if (authLoading || !user || !snapshotLoaded || !lg) return;
    if (pathname !== '/settings/business') return;

    const start = searchParams.get('business_profile_tour');
    if (start !== 'start') {
      handledKeyRef.current = null;
      return;
    }

    const dedupeKey = `${pathname}?business_profile_tour=start`;
    if (handledKeyRef.current === dedupeKey) return;
    handledKeyRef.current = dedupeKey;

    clearQuery();
    window.setTimeout(() => {
      startBusinessProfileTour(driverRef);
    }, 450);
  }, [authLoading, user, snapshotLoaded, lg, pathname, searchParams, clearQuery]);

  return null;
}
