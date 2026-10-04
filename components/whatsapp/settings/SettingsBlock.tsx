'use client';

import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { ProfileSection } from '@/components/settings/business-profile/ProfileSection';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';

export function SettingsPageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('w-full max-w-5xl space-y-6', className)}>{children}</div>;
}

/** Annotated settings row (same layout as Business profile and New item): explanation left, card right. */
export function SettingsBlock({
  id,
  title,
  description,
  children,
  bare,
}: {
  id?: string;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  /** Children render their own card(s). */
  bare?: boolean;
}) {
  return (
    <ProfileSection id={id} title={title} description={description}>
      {bare ? children : <div className="card space-y-4 p-4 md:p-5">{children}</div>}
    </ProfileSection>
  );
}

export function BotAddonLockedCard({ title, description }: { title: string; description: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="card flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center md:p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/30">
          <Lock className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{title}</p>
          <p className="mt-0.5 text-sm text-text-secondary">{description}</p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          Unlock WhatsApp Bot
        </Button>
      </div>
      {open ? (
        <WhatsAppAddonModal
          addonType="whatsapp_bot"
          onClose={() => setOpen(false)}
          onPurchaseSuccess={() => {
            setOpen(false);
            window.location.reload();
          }}
        />
      ) : null}
    </>
  );
}
