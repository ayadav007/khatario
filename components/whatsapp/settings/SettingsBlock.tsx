'use client';

import React, { useState } from 'react';
import { Lock } from 'lucide-react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { ProfileSection } from '@/components/settings/business-profile/ProfileSection';
import { UpgradeModal } from '@/components/subscription/UpgradeModal';
import type { PlatformModule } from '@/lib/platform-modules';

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

function LockedCard({
  title,
  description,
  cta,
  featureName,
  moduleKey,
  initialPlanId,
}: {
  title: string;
  description: string;
  cta: string;
  featureName: string;
  moduleKey: PlatformModule;
  initialPlanId?: string;
}) {
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
          {cta}
        </Button>
      </div>
      {open ? (
        <UpgradeModal
          limitType="feature"
          featureName={featureName}
          moduleKey={moduleKey}
          initialPlanId={initialPlanId}
          onClose={() => setOpen(false)}
          onUpgradeSuccess={() => {
            setOpen(false);
            window.location.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Upsell for WABA, AI, templates, inbox and automation, which come with the Connect add-on. */
export function ConnectLockedCard({ title, description }: { title: string; description: string }) {
  return (
    <LockedCard
      title={title}
      description={description}
      cta="Get Connect"
      featureName="Khatario Connect"
      moduleKey="connect"
      initialPlanId="connect"
    />
  );
}

/** Upsell for billing-plan WhatsApp features such as automatic payment reminders. */
export function BillingPlanLockedCard({
  title,
  description,
  featureName,
}: {
  title: string;
  description: string;
  featureName: string;
}) {
  return (
    <LockedCard
      title={title}
      description={description}
      cta="See plans"
      featureName={featureName}
      moduleKey="billing"
      initialPlanId="growth"
    />
  );
}
