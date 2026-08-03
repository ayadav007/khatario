'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Removed — GSTIN and registration live on Business Profile. */
export default function TaxSettingsRedirectPage() {
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
