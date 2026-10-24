'use client';

import React from 'react';
import { PageHeader } from '@/components/layout/PageHeader';

type MobileReportHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

/** Report pages share the app page header: stacked on mobile, one row from md. */
export function MobileReportHeader({ title, subtitle, actions, className }: MobileReportHeaderProps) {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      actions={actions}
      actionsClassName="no-print"
      className={className}
    />
  );
}
