'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/reports/profit-loss', label: 'Standard', testId: 'pl-tab-standard' },
  { href: '/reports/profit-loss/schedule-iii', label: 'Schedule III', testId: 'pl-tab-schedule-iii' },
  { href: '/reports/profit-loss/compare', label: 'Compare', testId: 'pl-tab-compare' },
] as const;

/** Standard / Schedule III / Compare switch above the Profit & Loss pages. Renders nothing on other sub-pages. */
export function ProfitLossTabs() {
  const pathname = (usePathname() || '').replace(/\/+$/, '');
  if (!TABS.some((t) => t.href === pathname)) return null;

  return (
    <nav aria-label="Profit and Loss views" className="no-print mb-4 md:mb-6">
      <div className="inline-flex rounded-lg border border-border bg-white p-1 dark:bg-slate-900">
        {TABS.map((t) => {
          const active = t.href === pathname;
          return (
            <Link
              key={t.href}
              href={t.href}
              data-testid={t.testId}
              aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 ${
                active
                  ? 'bg-primary-50 font-semibold text-primary-700 dark:bg-slate-800 dark:text-primary-300'
                  : 'text-text-secondary hover:bg-slate-50 hover:text-text-primary dark:hover:bg-slate-800/60'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
