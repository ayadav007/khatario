'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { getMobileListCreateAction } from '@/lib/mobile-navigation';
import { PageHeader } from '@/components/layout/PageHeader';

type ListPageHeaderProps = {
  title: string;
  description?: string;
  /** Primary actions (filters, new, etc.) — beside the title from md, below it on mobile. */
  actions?: ReactNode;
  /** When true, always show actions on mobile (e.g. secondary-only actions). */
  showActionsOnMobile?: boolean;
};

/**
 * List / index pages. The mobile TopBar still owns the primary "+" when the route
 * registers one, so that button is not repeated here unless showActionsOnMobile is set.
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
    <PageHeader
      title={title}
      subtitle={description}
      actions={actions}
      actionsClassName={hideActionsOnMobile ? 'max-md:hidden' : undefined}
    />
  );
}
