'use client';

import type { ReactNode } from 'react';
import { MessageSquare } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { WhatsAppSettingsNav } from '@/components/whatsapp/settings/WhatsAppSettingsNav';
import { useAuth } from '@/contexts/AuthContext';

export default function WhatsAppSettingsLayout({ children }: { children: ReactNode }) {
  const { hasPlatformModule } = useAuth();

  return (
    <SettingsPageShell
      title="WhatsApp"
      description="Connect your business number, then choose what Khatario sends and how customer chats are answered."
      icon={MessageSquare}
    >
      <WhatsAppSettingsNav hasConnect={hasPlatformModule('connect')} />
      {children}
    </SettingsPageShell>
  );
}
