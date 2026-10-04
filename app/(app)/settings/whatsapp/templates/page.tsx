'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { TenantTemplatesPanel } from '@/components/whatsapp/TenantTemplatesPanel';
import { ConnectLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';

export default function WhatsAppTemplatesPage() {
  const { hasConnect, loading } = useWhatsAppAccess();

  return (
    <SettingsPageBody>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      ) : hasConnect ? (
        <TenantTemplatesPanel />
      ) : (
        <SettingsBlock
          bare
          title="Message templates"
          description="Meta-approved wording for invoices, reminders and order updates sent through the official WhatsApp Business API."
        >
          <ConnectLockedCard
            title="Message templates come with Connect"
            description="Create and submit templates to Meta so you can message customers outside the 24-hour window."
          />
        </SettingsBlock>
      )}
    </SettingsPageBody>
  );
}
