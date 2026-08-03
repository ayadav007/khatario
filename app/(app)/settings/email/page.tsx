'use client';

export const dynamic = 'force-dynamic';

import { Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmailSettingsTab } from '@/components/settings/EmailSettingsTab';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';

export default function EmailSettingsPage() {
  const { business } = useAuth();

  if (!business) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <SettingsPageShell
      title="Email settings"
      description="Configure how this business sends invoices, purchase orders, and payment reminders by email."
      icon={Mail}
    >
      <EmailSettingsTab businessId={business.id} />
    </SettingsPageShell>
  );
}
