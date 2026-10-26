'use client';

import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { WhatsAppSettingsNav } from '@/components/whatsapp/settings/WhatsAppSettingsNav';

export default function WhatsAppSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <SettingsPageShell
      title="WhatsApp"
      description="Connect your business number, then choose what Khatario sends and how customer chats are answered."
      icon={MessageSquare}
    >
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:gap-6">
        <WhatsAppSettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </SettingsPageShell>
  );
}
