'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect } from 'react';
import { BusinessProfileTab } from '@/components/settings/BusinessProfileTab';
import { BusinessProfileTour } from '@/components/onboarding/BusinessProfileTour';
import Link from 'next/link';
import { ChevronRight, Building } from 'lucide-react';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

export default function BusinessSettingsPage() {
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? window.location.hash : '';
    if (!raw || raw.length < 2) return;
    const id = raw.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      <Suspense fallback={null}>
        <BusinessProfileTour />
      </Suspense>

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Link href="/settings" className="hover:text-primary-600 transition">Settings</Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-muted">Organization Settings</span>
        <ChevronRight className="w-4 h-4" />
        <span className="text-text-primary font-medium">Business Profile</span>
      </div>

      {/* Header — tour anchor */}
      <div className="flex items-center gap-3" data-tour="bp-intro">
        <div className="p-3 bg-teal-100 rounded-xl">
          <Building className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Business Profile</h1>
          <p className="text-sm text-text-secondary">Configure your company details, GSTIN, and logo</p>
        </div>
      </div>

      <BusinessProfileTab />
    </div>
  );
}

