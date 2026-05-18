'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useLayoutData } from '@/contexts/LayoutDataContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { AppLayout } from '@/components/layout/AppLayout';

interface EmployeesLayoutProps {
  children: React.ReactNode;
}

/** PBAC resource for useAuthorizationGuard / hasCapability (must match authorize() module keys). */
function getEmployeesSectionResource(pathname: string | null): string {
  if (!pathname) return 'employees';
  if (pathname.includes('/attendance')) return 'attendance';
  if (pathname.includes('/leaves')) return 'leave_requests';
  if (pathname.includes('/salary')) return 'payroll';
  if (pathname.includes('/commissions')) return 'commissions';
  return 'employees';
}

function EmployeesLayout({ children }: EmployeesLayoutProps) {
  const pathname = usePathname();
  const { user, business } = useAuth();
  const { snapshotLoaded } = useLayoutData();
  const resource = getEmployeesSectionResource(pathname);

  const { status, reason, code } = useAuthorizationGuard({
    resource,
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  if (!snapshotLoaded || status === 'loading') {
    return <>{children}</>;
  }

  if (status === 'denied') {
    return (
      <AppLayout>
        <AccessDenied module={resource} action="read" details={reason} code={code || 'PAGE_ACCESS_DENIED'} />
      </AppLayout>
    );
  }

  return <>{children}</>;
}

export default EmployeesLayout;
