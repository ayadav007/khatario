'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InvoiceDesignPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/settings/templates');
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <p className="text-text-muted text-sm">Invoice layout lives under Templates &amp; printing. Redirecting…</p>
    </div>
  );
}
