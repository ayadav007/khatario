'use client';

export const dynamic = 'force-dynamic';

import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmailSettingsTab } from '@/components/settings/EmailSettingsTab';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

export default function EmailSettingsPage() {
  const { business } = useAuth();

  // The header renders straight away so it does not jump when the business loads.
  return (
    <SettingsPageShell
      title="Email settings"
      description="Configure how this business sends invoices, purchase orders, and payment reminders by email."
      icon={Mail}
    >
      {business ? (
        <EmailSettingsTab businessId={business.id} />
      ) : (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" aria-label="Loading" />
        </div>
      )}
    </SettingsPageShell>
  );
}
