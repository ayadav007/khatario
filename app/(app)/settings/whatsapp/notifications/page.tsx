'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { History, Loader2, Send } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';
import { ReminderSettingsTab } from '@/components/whatsapp/ReminderSettingsTab';
import { OwnerUpdatesCard } from '@/components/whatsapp/OwnerUpdatesCard';
import { BillingPlanLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';

export default function WhatsAppNotificationsPage() {
  const toast = useToastContext();
  const { hasAutoReminders, loading } = useWhatsAppAccess();

  return (
    <SettingsPageBody>
      {loading ? (
        <SettingsBlock title="Payment reminders" description="Automatic WhatsApp reminders for unpaid invoices.">
          <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
        </SettingsBlock>
      ) : hasAutoReminders ? (
        <ReminderSettingsTab />
      ) : (
        <SettingsBlock
          bare
          title="Payment reminders"
          description="Automatic WhatsApp reminders before and after invoices fall due."
        >
          <BillingPlanLockedCard
            title="Automatic reminders come with the Growth plan"
            description="Schedule payment reminders so customers are nudged without you lifting a finger. You can still send reminders yourself below."
            featureName="Automatic payment reminders"
          />
        </SettingsBlock>
      )}

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

      <OwnerUpdatesCard
        onToast={(message, type) => (type === 'error' ? toast.error(message) : type === 'success' ? toast.success(message) : toast.info(message))}
      />
    </SettingsPageBody>
  );
}
