'use client';

import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalHolidays } from '@/components/employee-portal/EmployeePortalHolidays';
import { EmployeePortalLoginForm } from '@/components/employee-portal/EmployeePortalLoginForm';

function HolidaysFallback() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
    </div>
  );
}

export default function EmployeePortalHolidaysPage() {
  const { loading, session } = useEmployeePortal();

  if (loading) return <HolidaysFallback />;
  if (!session) return <EmployeePortalLoginForm />;

  return (
    <Suspense fallback={<HolidaysFallback />}>
      <EmployeePortalHolidays />
    </Suspense>
  );
}
