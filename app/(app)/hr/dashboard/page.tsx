'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import {
  HrAdminDashboardView,
  type HrAdminOverview,
} from '@/components/hr/dashboard/HrAdminDashboardView';

export default function HrDashboardPage() {
  const { business, user, hasPlatformModule } = useAuth();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<HrAdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { status: authStatus, reason: authReason, code: authCode } = useAuthorizationGuard({
    resource: 'employees',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (!business?.id || !hasPlatformModule('hr')) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/hr/dashboard/overview?business_id=${business.id}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load HR dashboard');
        }
        const data = (await res.json()) as HrAdminOverview;
        if (!cancelled) setOverview(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load HR dashboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [business?.id, hasPlatformModule]);

  if (!hasPlatformModule('hr')) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-text-primary">HR is not enabled</h1>
        <p className="text-sm text-text-secondary">
          Add the HR module from Settings to use this dashboard.
        </p>
        <Link href="/settings/subscription">
          <Button>View plans</Button>
        </Link>
      </div>
    );
  }

  if (authStatus === 'denied') {
    return (
      <AccessDenied
        module="employees"
        action="read"
        details={authReason}
        code={authCode || 'PAGE_ACCESS_DENIED'}
      />
    );
  }

  if (authStatus === 'loading') {
    return (
      <div className="flex min-h-[320px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <HrAdminDashboardView
      businessName={business?.name ?? 'Business'}
      userName={user?.name ?? 'User'}
      overview={overview}
      loading={loading}
      error={error}
    />
  );
}
