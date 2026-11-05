'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { WIDE_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS, FORM_PAGE_CONTENT_CLASS } from '@/lib/page-layout';
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader';

type SettingsPageShellProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  headerId?: string;
  tourAnchor?: string;
  children: ReactNode;
  className?: string;
  /**
   * `wide` (default): lists, tables and card grids use the whole column.
   * `form`: single-column forms stay readable, left-aligned at max-w-3xl.
   */
  width?: 'wide' | 'form';
};

export function SettingsPageShell({
  title,
  description,
  icon,
  actions,
  headerId,
  tourAnchor,
  children,
  className,
  width = 'wide',
}: SettingsPageShellProps) {
  return (
    <div className={clsx(WIDE_PAGE_CONTENT_CLASS, width === 'form' && FORM_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS, className)}>
      <SettingsPageHeader
        title={title}
        description={description}
        icon={icon}
        actions={actions}
        id={headerId}
        tourAnchor={tourAnchor}
      />
      {children}
    </div>
  );
}
