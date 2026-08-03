'use client';

export const dynamic = 'force-dynamic';

import AIConfigTab from '@/components/settings/AIConfigTab';
import { useAuth } from '@/contexts/AuthContext';
import { Bot, Loader2 } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

export default function AIConfigPage() {
  const { business } = useAuth();

  if (!business) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <SettingsPageShell
      title="AI Sales Agent"
      description="Configure how your AI sales agent responds to customers"
      icon={Bot}
    >
      <AIConfigTab businessId={business.id} />
    </SettingsPageShell>
  );
}
