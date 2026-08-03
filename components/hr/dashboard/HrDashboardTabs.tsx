'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import { Heart } from 'lucide-react';

export type HrDashboardTab = {
  id: string;
  label: string;
  href?: string;
  icon?: 'heart';
  active?: boolean;
  onClick?: () => void;
};

export function HrDashboardTabs({ tabs }: { tabs: HrDashboardTab[] }) {
  return (
    <div className="border-b border-border bg-white">
      <div className="flex items-end gap-6 px-4 md:px-6">
        {tabs.map((tab) => {
          const content = (
            <>
              <span className="flex items-center gap-1.5">
                {tab.label}
                {tab.icon === 'heart' ? (
                  <Heart className="h-3 w-3 fill-red-500 text-red-500" aria-hidden />
                ) : null}
              </span>
              {tab.active ? (
                <span
                  className="absolute -bottom-px left-1/2 h-0 w-0 -translate-x-1/2 border-x-[6px] border-b-[6px] border-x-transparent border-b-primary-600"
                  aria-hidden
                />
              ) : null}
            </>
          );

          const className = clsx(
            'relative pb-3 pt-3 text-[11px] font-semibold uppercase tracking-wider transition-colors',
            tab.active
              ? 'text-primary-600'
              : 'text-text-secondary hover:text-text-primary',
          );

          if (tab.href) {
            return (
              <Link key={tab.id} href={tab.href} className={className}>
                {content}
              </Link>
            );
          }

          return (
            <button
              key={tab.id}
              type="button"
              onClick={tab.onClick}
              className={className}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}
