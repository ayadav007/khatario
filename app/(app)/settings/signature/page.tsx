'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Signature upload lives on Business profile — single source of truth. */
export default function SignatureSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/business#bp-signature');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <p className="text-text-muted text-sm">Opening business profile…</p>
    </div>
  );
}



