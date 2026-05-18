'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { SettingsHub } from '@/components/settings/SettingsHub';
import { withPageAuth } from '@/lib/auth/withPageAuth';

function SettingsLandingPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const tab = searchParams?.get('tab');
    if (tab === 'subscription') {
      router.replace('/settings/subscription');
    }
  }, [searchParams, router]);

  return <SettingsHub />;
}

export default withPageAuth('settings', 'read', SettingsLandingPage);
