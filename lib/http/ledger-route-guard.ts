import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { periodGuardResponse } from '@/lib/http/period-guards';

export type LedgerGuardResult =
  | { ok: true; businessId: string; userId: string; branchId: string | null }
  | { ok: false; response: NextResponse };

/**
 * Tenant from the session, branch resolution, PBAC, ledger feature gate and period lock.
 * Pass `dates` for writes; omit for reads.
 */
export async function guardLedgerRoute(
  request: NextRequest,
  opts: {
    claimedBusinessId?: string | null;
    branchId?: string | null;
    resource?: string;
    action: 'read' | 'create' | 'update' | 'delete';
    dates?: Array<string | Date | null | undefined>;
    actionLabel?: string;
    checkGstFiled?: boolean;
  }
): Promise<LedgerGuardResult> {
  const tenant = requireTenantBusinessId(request, opts.claimedBusinessId);
  if (!tenant.ok) return tenant;
  const businessId = tenant.businessId;
  const userId = getUserIdFromRequest(request);
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  let branchId: string | null = null;
  if (opts.action !== 'read') {
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    try {
      branchId = await resolveBranchId({ branchId: opts.branchId || null, businessId });
    } catch (error: any) {
      const status = error?.code === 'NO_DEFAULT_BRANCH' ? 500 : 400;
      return { ok: false, response: NextResponse.json({ error: error?.message || 'Invalid branch' }, { status }) };
    }
  }

  try {
    await authorize(userId, opts.resource || 'journal', opts.action, {
      businessId,
      ...(branchId ? { branchId } : {}),
      ...(opts.dates?.[0] ? { entry_date: opts.dates[0] } : {}),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }

  try {
    await enforceAccess({
      businessId,
      userId,
      branchId,
      feature: FeatureKeys.LEDGER_ACCOUNTING,
      branchPermission: opts.action === 'read' ? 'view' : 'create_transactions',
    });
  } catch (e) {
    const res = enforceAccessErrorResponse(e);
    if (res) return { ok: false, response: res };
    throw e;
  }

  if (opts.dates?.length) {
    const lockRes = await periodGuardResponse({
      businessId,
      branchId,
      dates: opts.dates,
      action: opts.actionLabel || 'post this entry',
      checkGstFiled: opts.checkGstFiled,
    });
    if (lockRes) return { ok: false, response: lockRes };
  }

  return { ok: true, businessId, userId, branchId };
}
