'use client';

import React, { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  FileText,
  Package,
  Users,
  MoreHorizontal,
  CalendarCheck,
  MessageSquare,
  Contact,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBadges } from '@/contexts/BadgeContext';
import { useAuth } from '@/contexts/AuthContext';
import {
  CONNECT_AGENT_HOME_PATH,
  isConnectAgentSeat,
} from '@/lib/users/connect-seats';

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { badgeCounts, refreshBadgeCounts } = useBadges();
  const { user, platformSession, hasPlatformModule } = useAuth();
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  const hrOnly = hasPlatformModule('hr') && !hasPlatformModule('billing');
  const connectOnly = hasPlatformModule('connect') && !hasPlatformModule('billing');
  const hasConnect = hasPlatformModule('connect');
  const isConnectAgent = isConnectAgentSeat(user);
  const attendanceHref = '/employees/attendance';

  useEffect(() => {
    // Refresh counts every 10 minutes on mobile (where BottomNav is visible)
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      const interval = setInterval(refreshBadgeCounts, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshBadgeCounts]);

  const navItems = useMemo(() => {
    if (isConnectAgent) {
      return [
        {
          href: homeHref === '/dashboard' ? CONNECT_AGENT_HOME_PATH : homeHref,
          label: 'Chats',
          icon: MessageSquare,
        },
        { href: '/whatsapp/contacts', label: 'Contacts', icon: Contact },
        { href: '/customers', label: 'Parties', icon: Users },
        { href: '/more', label: 'More', icon: MoreHorizontal },
      ];
    }

    if (hrOnly) {
      return [
        { href: homeHref, label: 'Home', icon: Home },
        { href: '/employees', label: 'Team', icon: Users },
        { href: attendanceHref, label: 'Attendance', icon: CalendarCheck },
        { href: '/more', label: 'More', icon: MoreHorizontal },
      ];
    }

    if (connectOnly) {
      return [
        { href: homeHref, label: 'Home', icon: Home },
        { href: '/whatsapp/conversations', label: 'Chats', icon: MessageSquare },
        { href: '/whatsapp/contacts', label: 'Contacts', icon: Contact },
        { href: '/more', label: 'More', icon: MoreHorizontal },
      ];
    }

    if (hasConnect) {
      return [
        { href: homeHref, label: 'Home', icon: Home },
        {
          href: '/invoices',
          label: 'Invoices',
          icon: FileText,
          badge: badgeCounts.unpaid_invoices > 0 ? badgeCounts.unpaid_invoices : null,
        },
        { href: '/whatsapp/conversations', label: 'Chats', icon: MessageSquare },
        { href: '/customers', label: 'Parties', icon: Users },
        { href: '/more', label: 'More', icon: MoreHorizontal },
      ];
    }

    return [
      { href: homeHref, label: 'Home', icon: Home },
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
      { href: '/customers', label: 'Parties', icon: Users },
      { href: '/more', label: 'More', icon: MoreHorizontal },
    ];
  }, [
    isConnectAgent,
    hrOnly,
    connectOnly,
    hasConnect,
    homeHref,
    badgeCounts.unpaid_invoices,
    badgeCounts.low_stock_items,
    attendanceHref,
  ]);

  return (
    <>
      {/* Quick-actions + FAB lives on dashboard only (QuickActionsFAB) */}

      {/* Bottom Navigation - Hidden on desktop (lg) */}
      <nav
        data-mobile-bottom-nav
        className="fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex items-center justify-around z-30 lg:hidden"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

          return (
            <Link
              key={`${item.label}:${item.href}`}
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
                {'badge' in item && item.badge && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={clsx('text-[10px] font-medium', isActive && 'text-primary-500')}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );
};
