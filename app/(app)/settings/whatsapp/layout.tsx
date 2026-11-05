'use client';

import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { WhatsAppSettingsNav } from '@/components/whatsapp/settings/WhatsAppSettingsNav';
import { ProfileSectionSplitProvider } from '@/components/settings/business-profile/ProfileSection';

export default function WhatsAppSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsPageShell
      title="WhatsApp"
      description="Connect your business number, then choose what Khatario sends and how customer chats are answered."
      icon={MessageSquare}
    >
      {/* Side nav only from xl: at lg the main column is about 520px once the sidebar and Schedule panel are open. */}
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:gap-6">
        <WhatsAppSettingsNav />
        <div className="min-w-0 flex-1">
          <ProfileSectionSplitProvider value="2xl">{children}</ProfileSectionSplitProvider>
        </div>
      </div>
    </SettingsPageShell>
  );
}
