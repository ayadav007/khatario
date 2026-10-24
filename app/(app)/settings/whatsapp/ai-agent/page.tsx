'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';
import { AiAgentPage } from '@/components/ai-agent/AiAgentPage';
import { ConnectLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppAiAgentPage() {
  const { business } = useAuth();
  const { hasConnect, loading } = useWhatsAppAccess();

  if (!business || loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!hasConnect) {
    return (
      <SettingsPageBody>
        <SettingsBlock
          bare
          title="AI agent"
          description="Answers customer questions on WhatsApp from your items, prices and FAQs, takes orders and hands chats to your team when needed."
        >
          <ConnectLockedCard
            title="The AI agent comes with Connect"
            description="Connect includes monthly AI replies on your WhatsApp Business number."
          />
        </SettingsBlock>
      </SettingsPageBody>
    );
  }

  return <AiAgentPage businessId={business.id} />;
}
