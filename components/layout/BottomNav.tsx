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
  Truck,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useBadges } from '@/contexts/BadgeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import {
  CONNECT_AGENT_HOME_PATH,
  isConnectAgentSeat,
} from '@/lib/users/connect-seats';

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { badgeCounts, refreshBadgeCounts } = useBadges();
  const { user, platformSession, hasPlatformModule } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  const hrOnly = hasPlatformModule('hr') && !hasPlatformModule('billing');
  const connectOnly = hasPlatformModule('connect') && !hasPlatformModule('billing');
  const hasConnect = hasPlatformModule('connect');
  const isConnectAgent = isConnectAgentSeat(user);
  const agentCanViewOrders = isConnectAgent && hasCapability('invoices', 'view');
  const attendanceHref = '/employees/attendance';

  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      const interval = setInterval(refreshBadgeCounts, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshBadgeCounts]);

  const navItems = useMemo(() => {
    if (isConnectAgent) {
      const items = [
        {
          href: homeHref === '/dashboard' ? CONNECT_AGENT_HOME_PATH : homeHref,
          label: 'Chats',
          icon: MessageSquare,
        },
        { href: '/whatsapp/contacts', label: 'Contacts', icon: Contact },
      ];
      if (agentCanViewOrders) {
        items.push({ href: '/orders', label: 'Orders', icon: Truck });
      } else {
        items.push({ href: '/customers', label: 'Parties', icon: Users });
      }
      items.push({ href: '/more', label: 'More', icon: MoreHorizontal });
      return items;
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
    agentCanViewOrders,
    hrOnly,
    connectOnly,
    hasConnect,
    homeHref,
    badgeCounts.unpaid_invoices,
    badgeCounts.low_stock_items,
    attendanceHref,
  ]);

  return (
    <nav data-mobile-bottom-nav className="mobile-bottom-nav">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

        return (
          <Link
            key={`${item.label}:${item.href}`}
            href={item.href}
            className={clsx('mobile-nav-item', isActive && 'mobile-nav-item-active')}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="relative z-[1] flex h-8 w-14 items-center justify-center">
              {isActive ? <span className="mobile-nav-pill" aria-hidden /> : null}
              <Icon
                className={clsx(
                  'relative z-[1] h-[22px] w-[22px] transition-transform',
                  isActive && 'scale-105'
                )}
                strokeWidth={isActive ? 2.35 : 1.9}
              />
              {'badge' in item && item.badge ? (
                <span className="absolute -right-0.5 -top-0.5 z-[2] flex h-4 min-w-[16px] items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </span>
            <span
              className={clsx(
                'text-[10px] leading-none tracking-wide',
                isActive ? 'font-semibold text-primary-700' : 'font-medium'
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
};
