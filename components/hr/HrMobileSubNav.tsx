'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { useAuth } from '@/contexts/AuthContext';
import { useShellLayoutSettings } from '@/contexts/LayoutDataContext';
import { buildMoreMenuSections } from '@/lib/more-navigation';
import { HR_NAV_SECTION_TITLE } from '@/lib/hr/hr-admin-nav';

/** Hide on detail / composer screens where horizontal nav adds noise. */
function shouldHideHrSubNav(pathname: string): boolean {
  const p = pathname.replace(/\/$/, '') || '/';
  if (p.endsWith('/new') || p.endsWith('/edit')) return true;
  if (/^\/employees\/[^/]+$/.test(p) && p !== '/employees/new') return true;
  if (p.includes('/payslips/')) return true;
  return false;
}

function isHrNavItemActive(pathname: string, href: string): boolean {
  const p = pathname.replace(/\/$/, '') || '/';
  const h = href.replace(/\/$/, '') || '/';
  if (h === '/employees') return p === '/employees';
  return p === h || p.startsWith(`${h}/`);
}

export function HrMobileSubNav() {
  const pathname = usePathname();
  const { platformSession } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const { warehousesEnabled, snapshotLoaded } = useShellLayoutSettings();

  const enabledModules = platformSession?.enabledModules ?? ['billing'];

  const items = useMemo(() => {
    if (!snapshotLoaded) return [];
    const sections = buildMoreMenuSections({
      isSupplier: false,
      warehousesEnabled: !!warehousesEnabled,
      hasCapability,
      enabledModules,
    });
    return sections.find((s) => s.title === HR_NAV_SECTION_TITLE)?.items ?? [];
  }, [snapshotLoaded, warehousesEnabled, hasCapability, enabledModules]);

  if (!items.length || shouldHideHrSubNav(pathname ?? '')) return null;

  return (
    <nav
      aria-label="HR sections"
      className="mb-3 flex gap-2 overflow-x-auto border-b border-border pb-2 md:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = isHrNavItemActive(pathname ?? '', item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              'shrink-0 whitespace-nowrap border-b-2 px-2 py-1 text-xs font-medium transition-colors',
              active
                ? 'border-primary-500 text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
