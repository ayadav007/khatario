'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HrDashboardTabs, type HrDashboardTab } from './HrDashboardTabs';

export type HrShellNavItem = {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  children?: Array<{ key: string; label: string; href: string; hasSubmenu?: boolean }>;
};

export type HrWorkspaceShellProps = {
  brandLabel: string;
  companyName: string;
  userName: string;
  userInitials: string;
  navItems: HrShellNavItem[];
  tabs: HrDashboardTab[];
  basePath: string;
  settingsHref?: string;
  onLogout?: () => void;
  searchPlaceholder?: string;
  children: React.ReactNode;
  /** When true, sidebar + header fill the viewport (employee portal). */
  fullViewport?: boolean;
};

function isActive(pathname: string | null, base: string, href: string) {
  if (href === base || href === `${base}/`) {
    return pathname === base || pathname === `${base}/`;
  }
  return Boolean(pathname?.startsWith(href));
}

function UserAvatar({ initials }: { initials: string }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-text-primary"
      aria-hidden
    >
      {initials.slice(0, 2).toUpperCase()}
    </span>
  );
}

/**
 * Employee portal / ESS shell — Khatario tokens only (light surface, border-border).
 * Intentionally matches admin app language; not a separate dark “Keka” theme.
 */
export function HrWorkspaceShell({
  brandLabel,
  companyName,
  userName,
  userInitials,
  navItems,
  tabs,
  basePath,
  settingsHref,
  onLogout,
  searchPlaceholder = 'Search…',
  children,
  fullViewport = false,
}: HrWorkspaceShellProps) {
  const pathname = usePathname();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const flyoutCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlyoutTimer = useCallback(() => {
    if (flyoutCloseTimer.current) {
      clearTimeout(flyoutCloseTimer.current);
      flyoutCloseTimer.current = null;
    }
  }, []);

  const scheduleFlyoutClose = useCallback(() => {
    clearFlyoutTimer();
    flyoutCloseTimer.current = setTimeout(() => setHoveredKey(null), 120);
  }, [clearFlyoutTimer]);

  useEffect(() => () => clearFlyoutTimer(), [clearFlyoutTimer]);

  const hoveredItem = navItems.find((item) => item.key === hoveredKey);

  return (
    <div
      className={clsx(
        'flex w-full bg-background',
        fullViewport ? 'min-h-screen' : 'min-h-[calc(100vh-8rem)] -mx-page-x -mt-page-y mb-0',
      )}
    >
      {/* Sidebar — light Khatario surface */}
      <aside
        className={clsx(
          'hidden w-56 shrink-0 flex-col border-r border-border bg-surface text-text-primary lg:flex',
          fullViewport && 'min-h-screen',
        )}
        aria-label="Employee portal navigation"
      >
        <div className="flex h-14 items-center border-b border-border px-4">
          <span className="truncate text-sm font-semibold tracking-tight">{brandLabel}</span>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, basePath, item.href);
            const hasFlyout = (item.children?.length ?? 0) > 0;

            return (
              <div
                key={item.key}
                className="relative"
                onMouseEnter={() => {
                  if (hasFlyout) {
                    clearFlyoutTimer();
                    setHoveredKey(item.key);
                  }
                }}
                onMouseLeave={() => {
                  if (hasFlyout) scheduleFlyoutClose();
                }}
              >
                <Link
                  href={item.href}
                  className={clsx(
                    'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-slate-100 text-text-primary'
                      : 'text-text-secondary hover:bg-gray-50 hover:text-text-primary',
                  )}
                >
                  <span className="relative shrink-0">
                    <Icon className="h-4 w-4" aria-hidden />
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </div>
            );
          })}
        </nav>

        {onLogout ? (
          <div className="border-t border-border p-2">
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-gray-50 hover:text-text-primary"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
        ) : null}
      </aside>

      {/* Flyout for nested items */}
      {hoveredItem?.children?.length ? (
        <div
          className="fixed z-50 hidden lg:block"
          style={{ left: '14rem', top: '3.5rem' }}
          onMouseEnter={clearFlyoutTimer}
          onMouseLeave={scheduleFlyoutClose}
        >
          <div className="min-w-[200px] rounded-lg border border-border bg-white py-2 shadow-lg">
            {hoveredItem.children.map((child) => (
              <Link
                key={child.key}
                href={child.href}
                className="flex items-center justify-between px-4 py-2.5 text-sm text-text-secondary hover:bg-gray-50 hover:text-text-primary"
              >
                {child.label}
                {child.hasSubmenu ? <ChevronRight className="h-4 w-4 opacity-60" /> : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-text-primary md:text-base">
                {companyName}
              </p>
              {settingsHref ? (
                <Link
                  href={settingsHref}
                  className="rounded p-1 text-text-muted hover:bg-gray-50 hover:text-text-primary"
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              ) : null}
            </div>

            <div className="order-3 w-full md:order-none md:mx-auto md:w-auto md:flex-1 md:max-w-xl">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  className="focus-primary h-10 w-full rounded-lg border border-border bg-gray-50 pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted"
                  aria-label="Search"
                />
              </label>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden truncate text-sm font-medium text-text-primary sm:inline">
                {userName}
              </span>
              <ChevronDown className="hidden h-4 w-4 text-text-muted sm:block" aria-hidden />
              <UserAvatar initials={userInitials} />
            </div>
          </div>
        </header>

        <HrDashboardTabs tabs={tabs} />

        <main
          className={clsx(
            'flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6',
            fullViewport && 'pb-20 lg:pb-6',
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav */}
      {fullViewport ? (
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-white pb-[max(8px,env(safe-area-inset-bottom))] pt-1 lg:hidden"
          aria-label="Mobile portal navigation"
        >
          <div className="flex justify-around px-1">
            {navItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, basePath, item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={clsx(
                    'flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[9px] font-medium',
                    active ? 'text-primary-600' : 'text-text-secondary',
                  )}
                >
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {item.badge && item.badge > 0 ? (
                      <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold text-white">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </span>
                  {item.label}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              className="flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-1 text-[9px] font-medium text-text-secondary"
            >
              <span className="text-lg leading-none">⋯</span>
              More
            </button>
          </div>
          {mobileNavOpen ? (
            <div className="border-t border-border bg-white px-3 py-2">
              <div className="grid grid-cols-4 gap-2">
                {navItems.slice(5).map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className="flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] text-text-secondary hover:bg-gray-50"
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </nav>
      ) : null}

      {fullViewport ? (
        <div className="pointer-events-none fixed bottom-0 left-0 right-0 h-[calc(4.5rem+env(safe-area-inset-bottom))] lg:hidden" />
      ) : null}
    </div>
  );
}
