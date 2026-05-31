'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, FileText, Package, Users, MoreHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useOfflineBanner } from '@/contexts/OfflineBannerContext';
import { isOfflineCapable } from '@/lib/offline/offline-capable-routes';
import { MOBILE_TAB_ROOTS, normalizePath } from '@/lib/mobile-navigation';

const TAB_HREFS = MOBILE_TAB_ROOTS as readonly string[];

export const BottomNav: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { badgeCounts, refreshBadgeCounts } = useLayoutData();
  const { isOffline } = useNetworkStatus();
  const { flashBlockedFeature } = useOfflineBanner();

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

  const handleTabClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    const current = normalizePath(pathname);
    const target = normalizePath(href);

    if (isOffline && !isOfflineCapable(href)) {
      e.preventDefault();
      flashBlockedFeature();
      return;
    }

    if (current === target) {
      e.preventDefault();
      return;
    }

    // Collapse nested route to tab root synchronously (must stay in gesture handler for WebView).
    if (current.startsWith(`${target}/`)) {
      e.preventDefault();
      router.replace(href);
    }
    // Otherwise let <Link> perform default client navigation (push).
  };

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

  return (
    <nav
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

        return (
          <Link
            key={item.href}
            href={item.href}
            scroll={false}
            prefetch
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            onClick={(e) => handleTabClick(e, item.href)}
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
          </Link>
        );
      })}
    </nav>
  );
};
