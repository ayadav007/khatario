'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect } from 'react';
import { BusinessProfileTab } from '@/components/settings/BusinessProfileTab';
import { BusinessProfileTour } from '@/components/onboarding/BusinessProfileTour';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { Building } from 'lucide-react';
import { withPageAuth } from '@/lib/auth/withPageAuth';
import { useAuth } from '@/contexts/AuthContext';

function BusinessSettingsPage() {
  const { hasPlatformModule } = useAuth();
  const hasBilling = hasPlatformModule('billing');
  const hasHr = hasPlatformModule('hr');

  const description = hasBilling && hasHr
    ? 'Company details for billing, GST, payslips, and HR documents'
    : hasBilling
      ? 'Configure your company details, GSTIN, and logo'
      : hasHr
        ? 'Company details for payslips, letters, and the employee portal'
        : 'Configure your organization profile';

  useEffect(() => {
    const raw = typeof window !== 'undefined' ? window.location.hash : '';
    if (!raw || raw.length < 2) return;
    const id = raw.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <BusinessProfileTour />
      </Suspense>
      <SettingsPageShell
        title="Business Profile"
        description={description}
        icon={Building}
        tourAnchor="bp-intro"
      >
        <BusinessProfileTab />
      </SettingsPageShell>
    </>
  );
}

export default withPageAuth('settings', 'read', BusinessSettingsPage);
