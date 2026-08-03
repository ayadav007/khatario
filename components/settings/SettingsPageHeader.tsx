'use client';

import React from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';

export type SettingsPageHeaderProps = {
  /** Page title (shown in-page on md+; sr-only on mobile — TopBar shows the visible title). */
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Optional id for scroll / anchor (e.g. business profile). */
  id?: string;
  /** Optional data-tour anchor for onboarding. */
  tourAnchor?: string;
  /** Right-side actions (e.g. Add button). Shown on mobile when title row is hidden. */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * Shared settings page header: icon + title + description on desktop (md+).
 * On mobile the TopBar shows the page name; only actions render below the bar when provided.
 */
export function SettingsPageHeader({
  title,
  description,
  icon: Icon,
  id,
  tourAnchor,
  actions,
  className,
}: SettingsPageHeaderProps) {
  return (
    <div className={clsx('space-y-3 md:space-y-4', className)}>
      <h1 className="sr-only">{title}</h1>

      {actions ? (
        <div className="flex justify-end md:hidden">{actions}</div>
      ) : null}

      <div
        id={id}
        data-tour={tourAnchor}
        className="hidden md:flex md:items-start md:justify-between md:gap-3"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {Icon ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-100">
              <Icon className="h-5 w-5 text-gray-700" aria-hidden />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h2 className="settings-page-title">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
