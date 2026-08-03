'use client';

export const dynamic = 'force-dynamic';

import { CalendarDays } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { LeavePlanSettingsPanel } from '@/components/settings/hr/LeavePlanSettingsPanel';

export default function LeavePlanSettingsPage() {
  return (
    <SettingsPageShell
      title="Leave plan"
      description="Quotas, accrual, sandwich policy, year-end rules, and approval chain"
      icon={CalendarDays}
    >
      <LeavePlanSettingsPanel />
    </SettingsPageShell>
  );
}
