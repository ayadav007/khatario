'use client';

import { Suspense } from 'react';
import { SubscriptionTab } from '@/components/settings/SubscriptionTab';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { useAuth } from '@/contexts/AuthContext';
import { CreditCard } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function SubscriptionSettingsPage() {
  const { business } = useAuth();

  return (
    <SettingsPageShell
      title="Subscription & Billing"
      description="Manage your plan and billing information"
      icon={CreditCard}
    >
      {business?.id ? (
        <Suspense
          fallback={
            <div className="flex justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" />
            </div>
          }
        >
          <SubscriptionTab businessId={business.id} />
        </Suspense>
      ) : null}
    </SettingsPageShell>
  );
}
