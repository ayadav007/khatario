'use client';

import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { ScanRecordBillsScreen } from '@/components/purchases/ScanRecordBillsScreen';

function ScanRecordGate() {
  const { user, business } = useAuth();
  const { allowed, loading, reason } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'create',
    skipCheck: !user?.id || !business?.id,
  });

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <AccessDenied
        module="purchases"
        action="create"
        details={reason}
        code="PURCHASE_SCAN_DENIED"
      />
    );
  }

  return <ScanRecordBillsScreen />;
}

export default function ScanRecordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-sm text-text-secondary">
          Loading…
        </div>
      }
    >
      <ScanRecordGate />
    </Suspense>
  );
}
