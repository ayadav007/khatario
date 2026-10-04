'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';
import { WhatsAppShopSection } from '@/components/ai-agent/WhatsAppShopSection';
import { ConnectLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppShopSettingsPage() {
  const { business } = useAuth();
  const { hasConnect, loading } = useWhatsAppAccess();

  return (
    <SettingsPageBody>
      {!business || loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      ) : !hasConnect ? (
        <SettingsBlock
          bare
          title="Take orders on WhatsApp"
          description="Customers browse your items, send a cart and get a payment link. Paid orders are invoiced automatically."
        >
          <ConnectLockedCard
            title="The WhatsApp shop comes with Connect"
            description="Take orders and payments inside WhatsApp."
          />
        </SettingsBlock>
      ) : (
        <WhatsAppShopSection businessId={business.id} />
      )}
    </SettingsPageBody>
  );
}
