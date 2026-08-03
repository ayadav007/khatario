'use client';

export const dynamic = 'force-dynamic';

import { Users } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HrEmployeeSettingsPanel } from '@/components/settings/hr/HrEmployeeSettingsPanel';

export default function HrEmployeeSettingsPage() {
  return (
    <SettingsPageShell
      title="Employee management"
      description="Probation, employee ID series, and portal visibility"
      icon={Users}
    >
      <HrEmployeeSettingsPanel />
    </SettingsPageShell>
  );
}
