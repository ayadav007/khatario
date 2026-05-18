'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FileText, Package, Users, MoreHorizontal, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useLayoutData } from '@/contexts/LayoutDataContext';

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { badgeCounts, refreshBadgeCounts } = useLayoutData();

  useEffect(() => {
    // Refresh counts every 10 minutes on mobile (where BottomNav is visible)
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      const interval = setInterval(refreshBadgeCounts, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshBadgeCounts]);

  const navItems = [
    { 
      href: '/dashboard', 
      label: 'Home', 
      icon: Home 
    },
    { 
      href: '/invoices', 
      label: 'Invoices', 
      icon: FileText,
      badge: badgeCounts.unpaid_invoices > 0 ? badgeCounts.unpaid_invoices : null 
    },
    { 
      href: '/items', 
      label: 'Items', 
      icon: Package,
      badge: badgeCounts.low_stock_items > 0 ? badgeCounts.low_stock_items : null 
    },
    { 
      href: '/customers', 
      label: 'Parties', 
      icon: Users 
    },
    { 
      href: '/more', 
      label: 'More', 
      icon: MoreHorizontal 
    },
  ];

  // Hide global invoice FAB where the screen has its own primary action (dashboard quick actions, payment flows, statement view)
  const showGlobalInvoiceFab =
    pathname !== '/dashboard' &&
    !pathname?.startsWith('/payments') &&
    !pathname?.startsWith('/purchases/scan-record') &&
    !/\/customers\/[^/]+\/statement$/.test(pathname || '');

  return (
    <>
      {/* Floating Action Button - Hidden on desktop (lg); hidden on dashboard (quick-actions FAB there) */}
      {showGlobalInvoiceFab && (
        <Link
          href="/invoices/new"
          className="fixed bottom-20 right-4 md:right-6 z-40 w-14 h-14 bg-primary-500 text-white rounded-full shadow-large flex items-center justify-center hover:bg-primary-600 transition-colors lg:hidden active:scale-95"
        >
          <Plus className="w-6 h-6" />
        </Link>
      )}

      {/* Bottom Navigation - Hidden on desktop (lg) */}
      <nav className="fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex items-center justify-around z-30 lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex flex-col items-center justify-center gap-1 flex-1 h-full relative',
                'transition-colors active:bg-slate-50',
                isActive
                  ? 'text-primary-500'
                  : 'text-text-muted'
              )}
            >
              <div className="relative">
                <Icon className={clsx('w-5 h-5', isActive && 'text-primary-500')} />
                {item.badge && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white ring-2 ring-surface">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary-500 rounded-b-full" />
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
};
