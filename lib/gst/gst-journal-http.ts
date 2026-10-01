import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { periodGuardResponse } from '@/lib/http/period-guards';

/** Branch, journal permission, ledger feature, and period lock for GST cash-ledger routes. */
export async function openGstJournal(opts: {
  businessId: string;
  userId: string;
  branchIdParam?: string | null;
  entryDate?: string;
  permission: 'read' | 'create';
  action: string;
}): Promise<{ branchId: string } | NextResponse> {
  const { resolveBranchId } = await import('@/lib/branch-helpers');
  let branchId: string;
  try {
    branchId = await resolveBranchId({
      branchId: opts.branchIdParam || undefined,
      businessId: opts.businessId,
    });
  } catch (error: any) {
    if (
      error.code === 'BRANCH_NOT_FOUND' ||
      error.code === 'BRANCH_BUSINESS_MISMATCH' ||
      error.code === 'BRANCH_INACTIVE'
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error.code === 'NO_DEFAULT_BRANCH') {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  try {
    await authorize(opts.userId, 'journal', opts.permission, {
      businessId: opts.businessId,
      branchId,
      ...(opts.entryDate ? { entry_date: opts.entryDate } : {}),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  if (opts.permission === 'create') {
    try {
      await enforceAccess({
        businessId: opts.businessId,
        userId: opts.userId,
        branchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }
    if (opts.entryDate) {
      const locked = await periodGuardResponse({
        businessId: opts.businessId,
        branchId,
        dates: [opts.entryDate],
        action: opts.action,
        checkGstFiled: true,
      });
      if (locked) return locked;
    }
  }

  return { branchId };
}

export function isGstJournalContext(
  value: { branchId: string } | NextResponse
): value is { branchId: string } {
  return !(value instanceof NextResponse);
}
