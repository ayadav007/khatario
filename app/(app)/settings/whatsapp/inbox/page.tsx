'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { BookOpen, Bot, ChevronRight, Loader2, Workflow, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useWhatsAppAccess } from '@/components/whatsapp/settings/useWhatsAppAccess';
import { InboxOwnershipSettingsCard } from '@/components/whatsapp/settings/InboxOwnershipSettingsCard';
import { ConnectLockedCard, SettingsBlock, SettingsPageBody } from '@/components/whatsapp/settings/SettingsBlock';
import { WHATSAPP_SETTINGS_BASE } from '@/components/whatsapp/settings/WhatsAppSettingsNav';

function LinkRow({ href, icon: Icon, title, body }: { href: string; icon: LucideIcon; title: string; body: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary group-hover:text-primary-700">{title}</p>
        <p className="mt-0.5 text-xs text-text-secondary">{body}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted group-hover:text-primary-600" aria-hidden />
    </Link>
  );
}

export default function WhatsAppInboxSettingsPage() {
  const { business } = useAuth();
  const { hasConnect, loading } = useWhatsAppAccess();

  if (loading || !business) {
    return (
      <SettingsPageBody>
        <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
      </SettingsPageBody>
    );
  }

  if (!hasConnect) {
    return (
      <SettingsPageBody>
        <SettingsBlock
          bare
          title="Shared inbox"
          description="Share one WhatsApp number with your team and reply faster with saved answers."
        >
          <ConnectLockedCard
            title="The shared inbox comes with Connect"
            description="Unlock conversations, team assignment, keyword auto-replies and saved replies."
          />
        </SettingsBlock>
      </SettingsPageBody>
    );
  }

  return (
    <SettingsPageBody>
      <SettingsBlock
        id="inbox-assignment"
        title="How your team shares chats"
        description="Chats move between Active, Requesting and Intervened. Agents pick up waiting chats with Intervene, so two people never answer the same customer."
      >
        <InboxOwnershipSettingsCard businessId={business.id} />
      </SettingsBlock>

      <SettingsBlock
        id="inbox-replies"
        title="Ready-made replies"
        description="Answers your team, or simple keyword rules, can send without typing. For smart answers, use the AI agent."
      >
        <div className="divide-y divide-border dark:divide-border-dark">
          <LinkRow
            href="/whatsapp/saved-replies"
            icon={BookOpen}
            title="Saved replies"
            body="Short answers your team inserts in a chat with a shortcut."
          />
          <LinkRow
            href="/whatsapp/flows"
            icon={Workflow}
            title="Flows"
            body="Guided journeys with buttons. Exact keywords start a flow; other questions go to the AI agent."
          />
          <LinkRow
            href={`${WHATSAPP_SETTINGS_BASE}/ai-agent`}
            icon={Bot}
            title="AI agent"
            body="Understands questions in any wording and can take orders."
          />
        </div>
      </SettingsBlock>
    </SettingsPageBody>
  );
}
