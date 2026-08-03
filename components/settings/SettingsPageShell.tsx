'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { WIDE_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS } from '@/lib/page-layout';
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
}: SettingsPageShellProps) {
  return (
    <div className={clsx(WIDE_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS, className)}>
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
