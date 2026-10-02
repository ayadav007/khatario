'use client';

export const dynamic = 'force-dynamic';

import { Bot, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { AiAgentPage } from '@/components/ai-agent/AiAgentPage';

export default function AiAgentSettingsRoute() {
  const { business } = useAuth();

  if (!business) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <SettingsPageShell
      title="AI Agent"
      description="Your WhatsApp sales agent: what it knows, how it talks and when it hands over to your team."
      icon={Bot}
    >
      <AiAgentPage businessId={business.id} />
    </SettingsPageShell>
  );
}
