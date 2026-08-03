'use client';

export const dynamic = 'force-dynamic';

import { Timer } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { OtPolicySettingsPanel } from '@/components/settings/hr/OtPolicySettingsPanel';

export default function OtPolicySettingsPage() {
  return (
    <SettingsPageShell
      title="Overtime policy"
      description="OT pay rules, comp-off, application limits, and approval chain"
      icon={Timer}
    >
      <OtPolicySettingsPanel />
    </SettingsPageShell>
  );
}
