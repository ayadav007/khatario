'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { WhatsAppTab } from '@/components/settings/WhatsAppTab';
import { MessageSquare } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { useAuth } from '@/contexts/AuthContext';

export default function WhatsAppSettingsPage() {
  const router = useRouter();
  const { loading, platformSession } = useAuth();
  const hasConnect = platformSession?.enabledModules.includes('connect') ?? false;

  useEffect(() => {
    if (loading || !platformSession) return;
    if (!hasConnect) {
      router.replace('/settings/products?upsell=connect');
    }
  }, [loading, platformSession, hasConnect, router]);

  if (loading || !hasConnect) {
    return null;
  }

  return (
    <SettingsPageShell
      title="Connect messaging"
      description="Bot rules, reminders, logs, and advanced WhatsApp configuration for the Connect product"
      icon={MessageSquare}
    >
      <WhatsAppTab />
    </SettingsPageShell>
  );
}
