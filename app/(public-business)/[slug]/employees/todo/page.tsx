'use client';

import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { EmployeePortalLoginForm } from '@/components/employee-portal/EmployeePortalLoginForm';
import { EmployeePortalTodoPage } from '@/components/employee-portal/EmployeePortalTodoPage';

export default function EmployeePortalTodoRoute() {
  const { loading, session } = useEmployeePortal();

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session) {
    return <EmployeePortalLoginForm />;
  }

  return <EmployeePortalTodoPage />;
}
