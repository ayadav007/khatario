'use client';

export const dynamic = 'force-dynamic';

import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useBotAddon } from '@/components/whatsapp/settings/useBotAddon';
import { WhatsAppShopSection } from '@/components/ai-agent/WhatsAppShopSection';
import { BotAddonLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppShopSettingsPage() {
  const { business } = useAuth();
  const { hasBotAddon, loading } = useBotAddon();

  return (
    <SettingsPageBody>
      {!business || loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      ) : !hasBotAddon ? (
        <SettingsBlock
          bare
          title="Take orders on WhatsApp"
          description="Customers browse your items, send a cart and get a payment link. Paid orders are invoiced automatically."
        >
          <BotAddonLockedCard
            title="The WhatsApp shop needs the WhatsApp Bot addon"
            description="Unlock it to take orders and payments inside WhatsApp."
          />
        </SettingsBlock>
      ) : (
        <WhatsAppShopSection businessId={business.id} />
      )}
    </SettingsPageBody>
  );
}
