'use client';

import { TaxSettingsTab } from '@/components/settings/TaxSettingsTab';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import Link from 'next/link';
import { ChevronRight, CreditCard } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function TaxSettingsPage() {
  return (
    
      <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <Link href="/settings" className="hover:text-primary-600 transition">Settings</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-muted">Taxes & Compliance</span>
          <ChevronRight className="w-4 h-4" />
          <span className="text-text-primary font-medium">Tax & GST Settings</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-3 bg-slate-100 rounded-xl">
            <CreditCard className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">Tax & GST Settings</h1>
            <p className="text-sm text-text-secondary">Configure GST rates, HSN codes, and tax slabs</p>
          </div>
        </div>

        {/* Existing Component */}
        <TaxSettingsTab />
      </div>
    
  );
}

