'use client';

import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';

export type SettingsPageHeaderProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Optional id for scroll / anchor (e.g. business profile). */
  id?: string;
  /** Optional data-tour anchor for onboarding. */
  tourAnchor?: string;
  actions?: React.ReactNode;
  className?: string;
};

/** Settings pages: title and subtitle above actions on mobile, one row from md. */
export function SettingsPageHeader({
  title,
  description,
  icon,
  id,
  tourAnchor,
  actions,
  className,
}: SettingsPageHeaderProps) {
  return (
    <PageHeader
      as="h1"
      title={title}
      subtitle={description}
      icon={icon}
      id={id}
      tourAnchor={tourAnchor}
      actions={actions}
      className={className}
    />
  );
}
