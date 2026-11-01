'use client';

import { Star } from 'lucide-react';
import { SettingsPageShell } from '@/components/settings/SettingsPageShell';
import { StoreReviewsManager } from '@/components/store/admin/StoreReviewsManager';

export default function StoreReviewsPage() {
  return (
    <SettingsPageShell
      title="Store Reviews"
      description="Approve photo reviews, hide the bad ones and reply to your shoppers."
      icon={Star}
    >
      <StoreReviewsManager />
    </SettingsPageShell>
  );
}
