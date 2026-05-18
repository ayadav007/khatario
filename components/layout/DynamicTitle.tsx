'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getMobileRouteTitle } from '@/lib/mobile-route-title';
import { useMobileHeaderTitleContext } from '@/contexts/MobileHeaderTitleContext';

/**
 * Sets document.title to match the current screen + business (same logic as mobile top bar).
 */
export function DynamicTitle() {
  const { business } = useAuth();
  const pathname = usePathname();
  const mobileHeaderCtx = useMobileHeaderTitleContext();
  const routeTitle = getMobileRouteTitle(pathname);
  const effectiveTitle = mobileHeaderCtx?.overrideTitle ?? routeTitle;

  useEffect(() => {
    const biz = business?.name?.trim();
    if (effectiveTitle && biz) {
      document.title = `${effectiveTitle} · ${biz}`;
    } else if (biz) {
      document.title = `${biz} - Modern Invoice & Billing`;
    } else {
      document.title = 'Modern Invoice & Billing';
    }
  }, [business?.name, effectiveTitle]);

  return null;
}

