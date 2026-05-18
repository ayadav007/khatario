'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { EmailSettingsTab } from '@/components/settings/EmailSettingsTab';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

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
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">
          Settings
        </Link>
        <ChevronRight className="w-4 h-4" />
        <Link href="/settings/integrations" className="hover:text-primary-600 transition">
          Integrations & Marketplace
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary font-medium">Email (SMTP)</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Email settings</h1>
        <p className="text-sm text-text-secondary mt-1">
          Configure how this business sends invoices, purchase orders, and payment reminders by email.
        </p>
      </div>

      <EmailSettingsTab businessId={business.id} />
    </div>
  );
}
