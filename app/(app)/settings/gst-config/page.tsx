'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function GstConfigRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/tax');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <p className="text-text-muted text-sm">Opening tax settings…</p>
    </div>
  );
}

