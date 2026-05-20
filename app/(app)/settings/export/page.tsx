'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ExportSettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/backup');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <p className="text-text-muted text-sm">Opening backup and restore…</p>
    </div>
  );
}
