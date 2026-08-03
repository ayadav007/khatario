'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GstConfigRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/business#bp-gst');
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-text-muted">Opening business profile…</p>
    </div>
  );
}
