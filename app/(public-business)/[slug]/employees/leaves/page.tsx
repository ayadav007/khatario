'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalLoginForm } from '@/components/employee-portal/EmployeePortalLoginForm';
import { EmployeePortalLeaveHub } from '@/components/employee-portal/EmployeePortalLeaveHub';

function LeaveHubFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
    </div>
  );
}

export default function EmployeePortalLeavesPage() {
  const { loading, session } = useEmployeePortal();

  if (loading) {
    return <LeaveHubFallback />;
  }

  if (!session) {
    return <EmployeePortalLoginForm />;
  }

  return (
    <Suspense fallback={<LeaveHubFallback />}>
      <EmployeePortalLeaveHub />
    </Suspense>
  );
}
