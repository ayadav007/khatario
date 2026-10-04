'use client';

export const dynamic = 'force-dynamic';

import { TenantTemplatesPanel } from '@/components/whatsapp/TenantTemplatesPanel';
import { SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppTemplatesPage() {
  return (
    <SettingsPageBody>
      <TenantTemplatesPanel />
    </SettingsPageBody>
  );
}
