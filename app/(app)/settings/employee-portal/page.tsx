'use client';

export const dynamic = 'force-dynamic';

import { Users } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { EmployeePortalSettingsPanel } from '@/components/settings/hr/EmployeePortalSettingsPanel';

export default function EmployeePortalSettingsPage() {
  return (
    <SettingsPageShell
      title="Employee portal"
      description="Self-service access, invites, and attendance kiosk"
      icon={Users}
    >
      <EmployeePortalSettingsPanel />
    </SettingsPageShell>
  );
}
