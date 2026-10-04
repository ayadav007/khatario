'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { History, Loader2, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useBotAddon } from '@/components/whatsapp/settings/useBotAddon';
import { ReminderSettingsTab } from '@/components/whatsapp/ReminderSettingsTab';
import { OwnerUpdatesCard } from '@/components/whatsapp/OwnerUpdatesCard';
import { BotAddonLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppNotificationsPage() {
  const toast = useToastContext();
  const { hasPlatformModule } = useAuth();
  const { hasBotAddon, loading } = useBotAddon();
  const hasConnect = hasPlatformModule('connect');

  return (
    <SettingsPageBody>
      {loading ? (
        <SettingsBlock title="Payment reminders" description="Automatic WhatsApp reminders for unpaid invoices.">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </SettingsBlock>
      ) : hasBotAddon ? (
        <ReminderSettingsTab />
      ) : (
        <SettingsBlock
          bare
          title="Payment reminders"
          description="Automatic WhatsApp reminders before and after invoices fall due."
        >
          <BotAddonLockedCard
            title="Auto reminders need the WhatsApp Bot addon"
            description="Schedule payment reminders so customers are nudged without you lifting a finger."
          />
        </SettingsBlock>
      )}

      {hasBotAddon && hasConnect ? (
        <SettingsBlock
          id="reminders-manual"
          title="Send now and history"
          description="Send reminders for chosen invoices right away, or check what was sent and whether it was delivered."
        >
          <div className="flex flex-wrap gap-2">
            <Link
              href="/whatsapp/reminders"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800"
            >
              <Send className="h-4 w-4" aria-hidden /> Send reminders
            </Link>
            <Link
              href="/whatsapp/reminders?tab=logs"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800"
            >
              <History className="h-4 w-4" aria-hidden /> Reminder history
            </Link>
          </div>
        </SettingsBlock>
      ) : null}

      <OwnerUpdatesCard
        onToast={(message, type) => (type === 'error' ? toast.error(message) : type === 'success' ? toast.success(message) : toast.info(message))}
      />
    </SettingsPageBody>
  );
}
