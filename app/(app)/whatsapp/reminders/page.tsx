'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Loader2, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { SendRemindersTab } from '@/components/whatsapp/SendRemindersTab';
import { ReminderLogsTab } from '@/components/whatsapp/ReminderLogsTab';
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader';
import { WIDE_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS } from '@/lib/page-layout';

const TABS = [
  { id: 'send', label: 'Send reminders' },
  { id: 'logs', label: 'History' },
] as const;

function RemindersContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') === 'logs' ? 'logs' : 'send';
  return (
    <div className={clsx(WIDE_PAGE_CONTENT_CLASS, STACK_PAGE_CLASS)}>
      <SettingsPageHeader
        title="Payment reminders"
        description="Send WhatsApp reminders for unpaid invoices now, and see what was sent."
        icon={Bell}
        actions={
          <Link
            href="/settings/whatsapp/notifications"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-primary hover:bg-gray-50 dark:border-border-dark dark:hover:bg-slate-800"
          >
            <Settings className="h-4 w-4" aria-hidden /> Auto reminder settings
          </Link>
        }
      />

      <nav aria-label="Reminder views" className="border-b border-border dark:border-border-dark">
        <ul className="flex gap-1">
          {TABS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => router.replace(t.id === 'send' ? pathname : `${pathname}?tab=${t.id}`)}
                aria-current={tab === t.id ? 'page' : undefined}
                className={clsx(
                  '-mb-px border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'border-primary-600 text-primary-700 dark:text-primary-300'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {tab === 'logs' ? <ReminderLogsTab /> : <SendRemindersTab />}
    </div>
  );
}

export default function WhatsAppRemindersPage() {
  return (
    <Suspense fallback={<Loader2 className="h-6 w-6 animate-spin text-text-muted" />}>
      <RemindersContent />
    </Suspense>
  );
}
