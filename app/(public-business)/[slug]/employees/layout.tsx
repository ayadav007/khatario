'use client';

import { EmployeePortalProvider } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalShell } from '@/components/employee-portal/EmployeePortalShell';

export default function EmployeePortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <EmployeePortalProvider>
      <EmployeePortalShell>{children}</EmployeePortalShell>
    </EmployeePortalProvider>
  );
}
