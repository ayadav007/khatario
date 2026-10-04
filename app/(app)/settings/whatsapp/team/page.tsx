'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';
import { ConnectTeamCard } from '@/components/whatsapp/settings/ConnectTeamCard';
import { ConnectLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppTeamSettingsPage() {
  const { business } = useAuth();
  const { hasConnect, loading } = useWhatsAppAccess();

  if (loading || !business) {
    return (
      <SettingsPageBody>
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </SettingsPageBody>
    );
  }

  if (!hasConnect) {
    return (
      <SettingsPageBody>
        <SettingsBlock bare title="WhatsApp agents" description="Give your team their own login to answer customers.">
          <ConnectLockedCard
            title="Agent seats come with Connect"
            description="Each Connect plan includes WhatsApp agent seats, separate from your Billing users."
          />
        </SettingsBlock>
      </SettingsPageBody>
    );
  }

  return (
    <SettingsPageBody>
      <SettingsBlock
        id="connect-agents"
        title="WhatsApp agents"
        description="Agents log in with their phone number and land in Conversations. They use Connect agent seats, not your Billing users. Move someone to Billing if they also need to create invoices."
      >
        <ConnectTeamCard />
      </SettingsBlock>
    </SettingsPageBody>
  );
}
