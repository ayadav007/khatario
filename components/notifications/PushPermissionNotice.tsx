'use client';

import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { isCapacitorNative } from '@/lib/capacitor/platform';

/**
 * Shown on the notifications page inside the Android app when the user has turned Khatario's
 * notifications off at the system level. Android cannot re-prompt once denied, so the only path
 * back is the app's notification settings; this says so without promising a sound or banner.
 */
export function PushPermissionNotice() {
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (!isCapacitorNative()) return;
    let active = true;
    void import('@/lib/push/client/capacitor-push').then(async ({ checkPushPermission }) => {
      const state = await checkPushPermission();
      if (active) setDenied(state === 'denied');
    });
    return () => {
      active = false;
    };
  }, []);

  if (!denied) return null;
  return (
    <div role="status" className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <BellOff className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">Phone notifications are off for Khatario.</p>
        <p className="mt-0.5">
          You will still see everything here. To get alerts on this phone, open Android Settings → Apps → Khatario → Notifications and allow
          them.
        </p>
      </div>
    </div>
  );
}
