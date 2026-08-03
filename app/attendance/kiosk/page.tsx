'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/** Legacy /attendance/kiosk → employee portal kiosk at /{slug}/employees/kiosk */
export default function AttendanceKioskRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const slug = searchParams?.get('slug') ?? searchParams?.get('b');

  useEffect(() => {
    if (slug) {
      router.replace(`/${slug}/employees/kiosk`);
    }
  }, [slug, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Loader2 className="mb-4 h-8 w-8 animate-spin text-text-muted" />
      {slug ? (
        <p className="text-sm text-text-secondary">Redirecting to employee kiosk…</p>
      ) : (
        <div className="max-w-sm space-y-2">
          <p className="text-sm text-text-secondary">
            Shared attendance kiosk has moved to your company employee portal.
          </p>
          <p className="text-xs text-text-muted">
            Use the link from your employer, e.g.{' '}
            <span className="font-mono">yoursite.com/your-company/employees/kiosk</span>
          </p>
        </div>
      )}
    </div>
  );
}
