import React from 'react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';

/** Full-width form column (matches settings / Business Profile width). */
export function FormPageContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={clsx(WIDE_PAGE_CONTENT_CLASS, className)}>{children}</div>;
}

/** Standard padded card shell for long forms; pairs with `form-page-shell` + `FormSection`. */
export function FormCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card padding="none" className={clsx('p-card-md md:p-card-lg lg:p-card-xl', className)}>
      {children}
    </Card>
  );
}

export { FormSection } from '@/components/ui/FormSection';
