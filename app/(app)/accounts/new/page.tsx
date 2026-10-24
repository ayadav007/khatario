'use client';

export const dynamic = 'force-dynamic';

import React from 'react';
import { useRouter } from 'next/navigation';
import { AccountCreateForm } from '@/components/accounts/AccountCreateForm';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';

export default function NewAccountPage() {
  const router = useRouter();
  const { business, user } = useAuth();
  const { allowed: canCreate, reason } = useAuthorizationGuard({
    resource: 'settings',
    action: 'create',
    skipCheck: !user?.id || !business?.id,
  });

  if (!canCreate) {
    return (
      <AccessDenied
        module="settings"
        action="create"
        details={reason}
        code="ACCOUNT_CREATE_DENIED"
      />
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-lg">
      <MobileDuplicatePageChrome
        title="Add account"
        description="Name the ledger and choose where it sits. Nature and the Profit & Loss section follow that choice."
      />
      <div className="card p-4 sm:p-5">
        <h1 className="mb-4 text-lg font-semibold text-text-primary">Add account</h1>
        <AccountCreateForm onCancel={() => router.back()} onCreated={() => router.push('/accounts')} />
      </div>
    </div>
  );
}
