'use client';

import React, { Suspense, useState, useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { DynamicTitle } from '@/components/layout/DynamicTitle';
import { PromotionBanner } from '@/components/promotions/PromotionBanner';
import { PromotionModal } from '@/components/promotions/PromotionModal';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { ProfileCompletionBanner } from '@/components/layout/ProfileCompletionBanner';
import { SubscriptionBanner } from '@/components/subscription/SubscriptionBanner';
import { ShellVersionBanner } from '@/components/printer/ShellVersionBanner';
import { useLayout } from '@/contexts/LayoutContext';
import { FeatureUpgradeModalProvider } from '@/contexts/FeatureUpgradeModalContext';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { getPosMode } from '@/lib/pos-settings';
import { MobileHeaderTitleProvider } from '@/contexts/MobileHeaderTitleContext';
import { TodoScheduleRailProvider } from '@/contexts/TodoScheduleRailContext';
import { TodoScheduleRail } from '@/components/todo/TodoScheduleRail';
import { PortalThemeSync } from '@/components/portal/PortalThemeSync';
import { MobileBackNavigation } from '@/components/layout/MobileBackNavigation';

/**
 * Persistent layout for main app routes
 * This layout persists across navigation, preventing Sidebar remounting
 */
function AppRouteLayoutInner({
  children,
}: {
  children: React.ReactNode;
}) {
  const { sidebarCollapsed } = useLayout();
  const pathname = usePathname();
  const [posMode, setPosMode] = useState(false);
  
  // Check POS mode on mount and listen for changes
  useEffect(() => {
    const checkPosMode = () => {
      setPosMode(getPosMode());
    };
    
    // Initial check
    checkPosMode();
    
    // Listen for POS mode changes
    const handlePosModeChange = () => {
      checkPosMode();
    };
    
    window.addEventListener('posModeChanged', handlePosModeChange);
    
    // Also check periodically (in case localStorage is changed directly)
    const interval = setInterval(checkPosMode, 500);
    
    return () => {
      window.removeEventListener('posModeChanged', handlePosModeChange);
      clearInterval(interval);
    };
  }, []);

  // Full-width pages (no padding, no top bar)
  const isFullWidthPage = pathname?.includes('/whatsapp/conversations');
  
  // Show date range picker on dashboard
  const showDateRange = pathname === '/dashboard';
  
  // Check if we're on the invoice creation page (where POS mode is active)
  const isInvoicePage = pathname === '/invoices/new';
  const isInvoiceComposer = pathname === '/invoices/new';

  // In POS mode, hide all navigation and make it full-screen
  if (posMode && isInvoicePage) {
    return (
      <MobileHeaderTitleProvider>
        <PortalThemeSync />
        <MobileBackNavigation />
        <div className="h-screen w-screen overflow-hidden bg-background">
          <DynamicTitle />
          <main className="h-full w-full">
            {children}
          </main>
          <PromotionModal />
        </div>
      </MobileHeaderTitleProvider>
    );
  }

  return (
    <TodoScheduleRailProvider>
      <MobileHeaderTitleProvider>
        <PortalThemeSync />
        <MobileBackNavigation />
        <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-background">
          <DynamicTitle />
          <Suspense fallback={<div className="w-64 h-screen bg-background animate-pulse" />}>
            <Sidebar />
          </Suspense>
          <div
            className={clsx(
              'flex min-h-screen min-w-0 max-w-full flex-col overflow-x-hidden transition-all duration-300 ease-in-out',
              sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'
            )}
          >
            {!isFullWidthPage && (
              <Suspense fallback={null}>
                <TopBar showDateRange={showDateRange} />
              </Suspense>
            )}
            {!isFullWidthPage && <SubscriptionBanner />}
            {!isFullWidthPage && <ShellVersionBanner />}
            {!isFullWidthPage && <ProfileCompletionBanner />}
            <PromotionBanner />
            <div className="flex min-h-0 min-w-0 flex-1 items-stretch overflow-x-hidden">
              <main
                className={clsx(
                  'min-h-0 min-w-0 flex-1',
                  isFullWidthPage
                    ? 'h-screen'
                    : isInvoiceComposer
                      ? 'px-4 lg:px-6 pt-2 lg:pt-3 pb-20 lg:pb-6'
                      : 'p-4 lg:p-6 pb-20 lg:pb-6'
                )}
              >
                {children}
              </main>
              {!isFullWidthPage && <TodoScheduleRail />}
            </div>
          </div>
          {!isFullWidthPage && <BottomNav />}
          <PromotionModal />
          <ProductTour />
        </div>
      </MobileHeaderTitleProvider>
    </TodoScheduleRailProvider>
  );
}

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FeatureUpgradeModalProvider>
      <AppRouteLayoutInner>{children}</AppRouteLayoutInner>
    </FeatureUpgradeModalProvider>
  );
}
