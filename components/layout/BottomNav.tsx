'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { MobileNavEditor } from '@/components/layout/MobileNavEditor';
import {
  MIDDLE_NAV_HREFS,
  MIDDLE_NAV_LABELS,
  displayedMiddle,
  pinnedFirstId,
  type MiddleNavId,
  type MobileNavContext,
} from '@/lib/mobile-bottom-nav';
import {
  CONNECT_AGENT_HOME_PATH,
  isConnectAgentSeat,
} from '@/lib/users/connect-seats';

const MIDDLE_ICONS = {
  invoices: FileText,
  items: Package,
  parties: Users,
  chats: MessageSquare,
  contacts: Contact,
  orders: Truck,
  team: Users,
  attendance: CalendarCheck,
} as const;

export const BottomNav: React.FC = () => {
  const pathname = usePathname();
  const { badgeCounts, refreshBadgeCounts } = useBadges();
  const { user, platformSession } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const homeHref = platformSession?.defaultHomePath ?? '/dashboard';
  const isConnectAgent = isConnectAgentSeat(user);
  const [editorOpen, setEditorOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const navContext: MobileNavContext = useMemo(
    () => ({
      modules: platformSession?.enabledModules ?? [],
      isConnectAgent,
      canViewInvoices: hasCapability('invoices', 'view'),
    }),
    [platformSession?.enabledModules, isConnectAgent, hasCapability],
  );

  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (isMobile) {
      const interval = setInterval(refreshBadgeCounts, 10 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [refreshBadgeCounts]);

  const navItems = useMemo(() => {
    const middle = displayedMiddle(navContext, user?.mobile_nav).map((id: MiddleNavId) => ({
      href: MIDDLE_NAV_HREFS[id],
      label: MIDDLE_NAV_LABELS[id],
      icon: MIDDLE_ICONS[id],
      badge:
        id === 'invoices' && badgeCounts.unpaid_invoices > 0
          ? badgeCounts.unpaid_invoices
          : id === 'items' && badgeCounts.low_stock_items > 0
            ? badgeCounts.low_stock_items
            : null,
    }));
    const first =
      pinnedFirstId(navContext) === 'chats'
        ? {
            href: homeHref === '/dashboard' ? CONNECT_AGENT_HOME_PATH : homeHref,
            label: 'Chats',
            icon: MessageSquare,
            badge: null,
          }
        : { href: homeHref, label: 'Home', icon: Home, badge: null };
    return [...[first], ...middle, { href: '/more', label: 'More', icon: MoreHorizontal, badge: null }];
  }, [navContext, user?.mobile_nav, homeHref, badgeCounts.unpaid_invoices, badgeCounts.low_stock_items]);

  const startPress = () => {
    suppressClick.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      suppressClick.current = true;
      setEditorOpen(true);
    }, 450);
  };

  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <>
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
            onPointerDown={startPress}
            onPointerUp={endPress}
            onPointerLeave={endPress}
            onPointerCancel={endPress}
            onContextMenu={(event) => {
              event.preventDefault();
              setEditorOpen(true);
            }}
            onClick={(event) => {
              if (!suppressClick.current) return;
              event.preventDefault();
              suppressClick.current = false;
            }}
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
                'text-[11px] leading-none tracking-wide',
                isActive ? 'font-semibold text-primary-700' : 'font-medium'
              )}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
    <MobileNavEditor open={editorOpen} onClose={() => setEditorOpen(false)} />
    </>
  );
};
