'use client';

export const dynamic = 'force-dynamic';

import { LogOut } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { HrExitSettingsPanel } from '@/components/settings/hr/HrExitSettingsPanel';

export default function HrExitSettingsPage() {
  return (
    <SettingsPageShell
      title="Exit process"
      description="Notice periods, exit reasons, and resignation approval chain"
      icon={LogOut}
    >
      <HrExitSettingsPanel />
    </SettingsPageShell>
  );
}
