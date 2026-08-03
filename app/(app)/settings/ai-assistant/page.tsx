'use client';

export const dynamic = 'force-dynamic';

import { AIAssistantSettingsPage } from '@/components/settings/AIAssistantSettingsPage';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, Sparkles } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

export default function AIAssistantSettingsRoute() {
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
      title="AI Assistant Settings"
      description="Customize how your AI assistant interacts with customers. Changes are saved when you click Save."
      icon={Sparkles}
    >
      <AIAssistantSettingsPage businessId={business.id} />
    </SettingsPageShell>
  );
}
