'use client';

import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import {
  EmployeePortalLoginForm,
  EmployeePortalUnavailable,
} from '@/components/employee-portal/EmployeePortalLoginForm';
import { EmployeePortalHome } from '@/components/employee-portal/EmployeePortalHome';

export default function EmployeePortalPage() {
  const { loading, session, portalEnabled } = useEmployeePortal();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (portalEnabled === false) {
    return <EmployeePortalUnavailable />;
  }

  if (!session) {
    return <EmployeePortalLoginForm />;
  }

  return <EmployeePortalHome />;
}
