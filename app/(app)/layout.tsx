'use client';

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { BottomNav } from '@/components/layout/BottomNav';
import { DynamicTitle } from '@/components/layout/DynamicTitle';
import { PromotionBanner } from '@/components/promotions/PromotionBanner';
import { PromotionModal } from '@/components/promotions/PromotionModal';
import { ProductTour } from '@/components/onboarding/ProductTour';
import { SubscriptionBanner } from '@/components/subscription/SubscriptionBanner';
import { ProfileRequiredModalProvider } from '@/contexts/ProfileRequiredModalContext';
import { TrialExtensionModal } from '@/components/subscription/TrialExtensionModal';
import { ShellVersionBanner } from '@/components/printer/ShellVersionBanner';
import { useLayout } from '@/contexts/LayoutContext';
import { FeatureUpgradeModalProvider } from '@/contexts/FeatureUpgradeModalContext';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  APP_MAIN_PADDING_CLASS,
  APP_MAIN_PADDING_COMPACT_CLASS,
} from '@/lib/page-layout';
import { getPosMode } from '@/lib/pos-settings';
import { usePlanFeature } from '@/hooks/usePlanFeature';
import { AccessibilityProvider } from '@/components/accessibility/AccessibilityProvider';
import { MobileHeaderTitleProvider } from '@/contexts/MobileHeaderTitleContext';
import { TodoScheduleRailProvider } from '@/contexts/TodoScheduleRailContext';
import { TodoScheduleRail } from '@/components/todo/TodoScheduleRail';
import { PortalThemeSync } from '@/components/portal/PortalThemeSync';
import { PortalThemeBootScript } from '@/components/portal/PortalThemeBootScript';
import { MobileBackNavigation } from '@/components/layout/MobileBackNavigation';
import { PullToRefresh } from '@/components/layout/PullToRefresh';
import { LastRouteTracker } from '@/components/layout/LastRouteTracker';
import { NetworkStatusBanner } from '@/components/system/NetworkStatusBanner';
import { SyncStatusBanner } from '@/components/system/SyncStatusBanner';
import { ModuleShellGuard } from '@/components/layout/ModuleShellGuard';
import { WebAccessGate } from '@/components/layout/WebAccessGate';
import { DesktopZoomShortcuts } from '@/components/desktop/DesktopZoomShortcuts';
import { ReturnReviewDialogHost } from '@/components/gst/ReturnReviewDialog';
import { isInsidePhoneApp } from '@/lib/capacitor/platform';

const GlobalSubscriptionUsageStrip = dynamic(
  () =>
    import('@/components/subscription/GlobalSubscriptionUsageStrip').then((m) => ({
      default: m.GlobalSubscriptionUsageStrip,
    })),
  { ssr: false },
);

const AssistantWidget = dynamic(
  () => import('@/components/assistant/AssistantWidget').then((m) => ({ default: m.AssistantWidget })),
  { ssr: false },
);

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
  const posAllowed = usePlanFeature('settings_pos_mode');
  const accessibilityOn = usePlanFeature('accessibility');
  // Inside the phone app's web view the app draws the title bar and tabs, so the site drops its own.
  const [inPhoneApp, setInPhoneApp] = useState(false);
  useEffect(() => setInPhoneApp(isInsidePhoneApp()), []);

  useEffect(() => {
    const syncPosMode = () => setPosMode(posAllowed && getPosMode());

    syncPosMode();
    window.addEventListener('posModeChanged', syncPosMode);

    const onStorage = (e: StorageEvent) => {
      if (e.key === 'pos_mode_enabled' || e.key === null) {
        syncPosMode();
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('posModeChanged', syncPosMode);
      window.removeEventListener('storage', onStorage);
    };
  }, [posAllowed]);

  const isConversationsPage = pathname?.includes('/whatsapp/conversations') ?? false;
  /** Full-bleed chat chrome (no TopBar/banners); BottomNav still shows on mobile for agents. */
  const isFullWidthPage = isConversationsPage;
  const showChrome = !inPhoneApp;
  const showDateRange =
    pathname === '/dashboard' || pathname === '/hr/dashboard';
  const isInvoicePage = pathname === '/invoices/new';
  const isInvoiceComposer = pathname === '/invoices/new';
  const isSalesOrderComposer = pathname === '/sales-orders/new';
  const isDocumentComposer = isInvoiceComposer || isSalesOrderComposer;
  const isSettingsRoute =
    pathname === '/settings' || (pathname?.startsWith('/settings/') ?? false);

  const shell = posMode && isInvoicePage ? (
      <MobileHeaderTitleProvider>
        <PortalThemeSync />
        <MobileBackNavigation />
        <LastRouteTracker />
        <div className="h-screen w-screen overflow-hidden bg-background">
          <NetworkStatusBanner />
          <SyncStatusBanner />
          <DynamicTitle />
          <main className="h-full w-full">
            <DesktopZoomShortcuts />
            <WebAccessGate><ModuleShellGuard>{children}</ModuleShellGuard></WebAccessGate>
          </main>
          <PromotionModal />
          <TrialExtensionModal />
        </div>
      </MobileHeaderTitleProvider>
  ) : (
    <TodoScheduleRailProvider>
      <MobileHeaderTitleProvider>
        <PortalThemeSync />
        <MobileBackNavigation />
        <PullToRefresh />
        <LastRouteTracker />
        <div className="min-h-screen min-w-0 max-w-full overflow-x-hidden bg-background">
          <NetworkStatusBanner />
          <SyncStatusBanner />
          <DynamicTitle />
          {showChrome && (
            <Suspense fallback={<div className="w-64 h-screen bg-background animate-pulse" />}>
              <Sidebar />
            </Suspense>
          )}
          <div
            className={clsx(
              'flex min-h-screen min-w-0 max-w-full flex-col overflow-x-hidden transition-all duration-300 ease-in-out',
              showChrome && (sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64')
            )}
          >
            {showChrome && !isFullWidthPage && (
              <Suspense fallback={null}>
                <TopBar showDateRange={showDateRange} />
              </Suspense>
            )}
            {showChrome && !isFullWidthPage && <SubscriptionBanner />}
            {showChrome && !isFullWidthPage ? <GlobalSubscriptionUsageStrip /> : null}
            {showChrome && !isFullWidthPage && <ShellVersionBanner />}
            {showChrome && <PromotionBanner />}
            <div className="flex min-h-0 min-w-0 flex-1 items-stretch overflow-x-hidden">
              <main
                className={clsx(
                  'min-h-0 min-w-0 flex-1',
                  isFullWidthPage
                    ? 'h-[calc(100dvh-4rem)] lg:h-screen'
                    : isDocumentComposer
                      ? APP_MAIN_PADDING_COMPACT_CLASS
                      : APP_MAIN_PADDING_CLASS,
                  isSettingsRoute && 'settings-ui-scale'
                )}
              >
                <DesktopZoomShortcuts />
                <WebAccessGate><ModuleShellGuard>{children}</ModuleShellGuard></WebAccessGate>
              </main>
              {showChrome && !isFullWidthPage && <TodoScheduleRail />}
            </div>
          </div>
          {showChrome && <BottomNav />}
          {showChrome && <PromotionModal />}
          <ReturnReviewDialogHost />
          {showChrome && <ProductTour />}
          {showChrome && <TrialExtensionModal />}
          {showChrome && !isFullWidthPage && !isDocumentComposer ? (
            <AssistantWidget mode="app" channel="trial_app" bottomOffset={76} mobileBottomOffset={90} />
          ) : null}
        </div>
      </MobileHeaderTitleProvider>
    </TodoScheduleRailProvider>
  );

  // Always the same wrapper: wrapping only once the plan loaded remounted every page and lost its state.
  return <AccessibilityProvider enabled={accessibilityOn}>{shell}</AccessibilityProvider>;
}

export default function AppRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FeatureUpgradeModalProvider>
      {/* Tenant theme is scoped to the app shell; marketing and public pages keep Khatario defaults. */}
      <PortalThemeBootScript />
      <ProfileRequiredModalProvider>
        <AppRouteLayoutInner>{children}</AppRouteLayoutInner>
      </ProfileRequiredModalProvider>
    </FeatureUpgradeModalProvider>
  );
}
