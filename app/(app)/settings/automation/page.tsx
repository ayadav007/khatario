'use client';

export const dynamic = 'force-dynamic';

import { WorkflowBuilder } from '@/components/automation/WorkflowBuilder';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { Zap } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

function AutomationPage() {
  const { business } = useAuth();

  return (
    <SettingsPageShell
      title="Workflow Automation"
      description="Automate repetitive tasks and save time"
      icon={Zap}
    >
      <WorkflowBuilder businessId={business?.id || ''} />
    </SettingsPageShell>
  );
}

export default withPageAuth('settings', 'read', AutomationPage);
