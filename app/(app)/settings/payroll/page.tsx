'use client';

export const dynamic = 'force-dynamic';

import { DollarSign } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HrPayrollSettingsPanel } from '@/components/settings/hr/HrPayrollSettingsPanel';

export default function PayrollSettingsPage() {
  return (
    <SettingsPageShell
      title="Payroll settings"
      description="Pay schedule and compliance preferences"
      icon={DollarSign}
    >
      <HrPayrollSettingsPanel />
    </SettingsPageShell>
  );
}
