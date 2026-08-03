'use client';

export const dynamic = 'force-dynamic';

import { Building2 } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HrDepartmentsSettings } from '@/components/settings/hr/HrDepartmentsSettings';

export default function DepartmentsSettingsPage() {
  return (
    <SettingsPageShell
      title="Departments & designations"
      description="Master lists for employee profiles and org reports"
      icon={Building2}
    >
      <HrDepartmentsSettings />
    </SettingsPageShell>
  );
}
