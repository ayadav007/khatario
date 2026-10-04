'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBotAddon } from '@/components/whatsapp/settings/useBotAddon';
import { AiAgentPage } from '@/components/ai-agent/AiAgentPage';
import { BotAddonLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppAiAgentPage() {
  const { business } = useAuth();
  const { hasBotAddon, loading } = useBotAddon();

  if (!business || loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!hasBotAddon) {
    return (
      <SettingsPageBody>
        <SettingsBlock
          bare
          title="AI agent"
          description="Answers customer questions on WhatsApp from your items, prices and FAQs, takes orders and hands chats to your team when needed."
        >
          <BotAddonLockedCard
            title="The AI agent needs the WhatsApp Bot addon"
            description="Unlock it to let the agent reply to customer chats on your number."
          />
        </SettingsBlock>
      </SettingsPageBody>
    );
  }

  return <AiAgentPage businessId={business.id} />;
}
