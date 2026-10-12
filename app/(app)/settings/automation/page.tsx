'use client';

export const dynamic = 'force-dynamic';

import { WorkflowBuilder } from '@/components/automation/WorkflowBuilder';
import { useAuth } from '@/contexts/AuthContext';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { Zap } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { useFeatureRouteGuard } from '@/hooks/useFeatureRouteGuard';

function AutomationPage() {
  const { business } = useAuth();
  const { canRender, loading } = useFeatureRouteGuard({ featureKey: 'workflow_automation' });
  if (loading) return null;
  if (!canRender) return null;

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
