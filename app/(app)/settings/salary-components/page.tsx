'use client';

export const dynamic = 'force-dynamic';

import { ListOrdered } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { SalaryComponentsSettingsPanel } from '@/components/settings/hr/SalaryComponentsSettingsPanel';

export default function SalaryComponentsSettingsPage() {
  return (
    <SettingsPageShell
      title="Salary components"
      description="Earnings and deductions used in salary structures and payslips"
      icon={ListOrdered}
    >
      <SalaryComponentsSettingsPanel />
    </SettingsPageShell>
  );
}
