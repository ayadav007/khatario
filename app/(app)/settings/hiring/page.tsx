'use client';

export const dynamic = 'force-dynamic';

import { UserCheck } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HrHiringSettingsPanel } from '@/components/settings/hr/HrHiringSettingsPanel';

export default function HiringSettingsPage() {
  return (
    <SettingsPageShell
      title="Hiring & onboarding"
      description="Recruitment defaults and onboarding automation"
      icon={UserCheck}
    >
      <HrHiringSettingsPanel />
    </SettingsPageShell>
  );
}
