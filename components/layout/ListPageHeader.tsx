'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { getMobileListCreateAction } from '@/lib/mobile-navigation';

type ListPageHeaderProps = {
  title: string;
  description?: string;
  /** Primary actions (filters, new, etc.) — right-aligned */
  actions?: ReactNode;
  /** When true, always show actions on mobile (e.g. secondary-only actions). */
  showActionsOnMobile?: boolean;
};

/**
 * List / index pages: on viewports below `md`, the mobile TopBar already shows the
 * route title, so we hide the duplicate visual heading and subtitle to save space.
 * The `<h1>` stays in the DOM (visually hidden &lt; md) for accessibility.
 * Primary "+" create actions move to TopBar when registered for the route.
 */
export function ListPageHeader({
  title,
  description,
  actions,
  showActionsOnMobile = false,
}: ListPageHeaderProps) {
  const pathname = usePathname();
  const topBarCreate = getMobileListCreateAction(pathname);
  const hideActionsOnMobile = !showActionsOnMobile && !!topBarCreate;

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 relative">
        <h1 className="list-page-h1">{title}</h1>
        {description ? (
          <p className="text-text-secondary text-sm mt-1 hidden md:block">{description}</p>
        ) : null}
      </div>
      {actions != null ? (
        <div
          className={clsx(
            'flex items-center gap-2 shrink-0',
            hideActionsOnMobile && 'hidden md:flex'
          )}
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
