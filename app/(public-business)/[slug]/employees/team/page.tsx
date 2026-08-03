'use client';

import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalLoginForm } from '@/components/employee-portal/EmployeePortalLoginForm';
import { EmployeePortalTeamSection } from '@/components/employee-portal/EmployeePortalTeamSection';

export default function EmployeePortalTeamPage() {
  const { loading, session } = useEmployeePortal();

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session) {
    return <EmployeePortalLoginForm />;
  }

  return (
    <EmployeePortalTeamSection
      businessId={session.business.id}
      userId={session.employee.id}
      slug={session.business.portal_slug}
      mode="team"
    />
  );
}
