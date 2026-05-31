'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { Home, FileText, Package, Users, MoreHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineBanner } from '@/contexts/OfflineBannerContext';
import { isOfflineCapable } from '@/lib/offline/offline-capable-routes';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import { MOBILE_TAB_ROOTS, normalizePath } from '@/lib/mobile-navigation';

const TAB_HREFS = MOBILE_TAB_ROOTS as readonly string[];

export const BottomNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [mounted, setMounted] = useState(false);
  const { badgeCounts, refreshBadgeCounts } = useLayoutData();
  const { isOffline } = useNetworkStatus();
  const { flashBlockedFeature } = useOfflineBanner();
  const navLockRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      const interval = setInterval(refreshBadgeCounts, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshBadgeCounts]);

  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth >= 1024) return;
    for (const href of TAB_HREFS) {
      router.prefetch(href);
    }
  }, [router]);

  const navigateToTab = useCallback(
    (href: string) => {
      if (navLockRef.current) return;

      if (isOffline && !isOfflineCapable(href)) {
        flashBlockedFeature();
        return;
      }

      const current = normalizePath(pathnameRef.current);
      const target = normalizePath(href);

      if (current === target) return;

      navLockRef.current = true;
      window.setTimeout(() => {
        navLockRef.current = false;
      }, 450);

      // Synchronous App Router call inside the tap handler (no startTransition).
      if (current.startsWith(`${target}/`)) {
        router.replace(href);
        return;
      }
      router.push(href);
    },
    [flashBlockedFeature, isOffline, router],
  );

  const handleTabActivate = useCallback(
    (href: string, e: React.MouseEvent | React.TouchEvent) => {
      if (e.type === 'touchend') {
        e.preventDefault();
      }
      navigateToTab(href);
    },
    [navigateToTab],
  );

  const navItems = [
    {
      href: '/dashboard',
      label: 'Home',
      icon: Home,
    },
    {
      href: '/invoices',
      label: 'Invoices',
      icon: FileText,
      badge: badgeCounts.unpaid_invoices > 0 ? badgeCounts.unpaid_invoices : null,
    },
    {
      href: '/items',
      label: 'Items',
      icon: Package,
      badge: badgeCounts.low_stock_items > 0 ? badgeCounts.low_stock_items : null,
    },
    {
      href: '/customers',
      label: 'Parties',
      icon: Users,
    },
    {
      href: '/more',
      label: 'More',
      icon: MoreHorizontal,
    },
  ];

  const nav = (
    <nav
      data-mobile-bottom-nav
      role="tablist"
      aria-label="Main navigation"
      className={clsx(
        'fixed bottom-0 left-0 right-0 z-50 lg:hidden',
        'border-t border-border bg-surface',
        'flex h-16 items-center justify-around',
        'pb-[env(safe-area-inset-bottom,0px)]',
        'touch-manipulation',
      )}
      style={{ transform: 'translateZ(0)' }}
    >
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href || pathname?.startsWith(item.href + '/');
        const useTouchEnd = isCapacitorNative();

        return (
          <button
            key={item.href}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            onTouchEnd={
              useTouchEnd ? (e) => handleTabActivate(item.href, e) : undefined
            }
            onClick={
              useTouchEnd ? undefined : () => navigateToTab(item.href)
            }
            className={clsx(
              'relative flex h-full flex-1 flex-col items-center justify-center gap-1',
              'transition-colors active:bg-slate-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset',
              isActive ? 'text-primary-500' : 'text-text-muted',
            )}
          >
            <div className="relative">
              <Icon className={clsx('h-5 w-5', isActive && 'text-primary-500')} />
              {item.badge ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 type-nav-label font-bold text-white ring-2 ring-surface">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </div>
            <span className="type-nav-label">{item.label}</span>
            {isActive ? (
              <div className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-b-full bg-primary-500" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );

  if (!mounted) return null;
  if (typeof window !== 'undefined' && window.innerWidth >= 1024) return null;

  return createPortal(nav, document.body);
};
