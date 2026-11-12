import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import type { BranchScope } from '@/lib/reports/profit-loss';

export interface PlRequestScope {
  businessId: string;
  userId: string;
  fromDate: string;
  toDate: string;
  financialYear: string | null;
  branch: BranchScope;
  consolidated: boolean;
  branchInfo: { id: string; name: string; branch_code: string | null; gstin: string | null } | null;
}

/**
 * The access checks and scope of GET /api/reports/profit-loss, in the same order with the same
 * status codes and bodies. Business and user come from the session, never from the query string.
 * Returns a NextResponse when the request must be refused.
 */
export async function resolvePlRequestScope(request: NextRequest): Promise<PlRequestScope | NextResponse> {
  const { searchParams } = new URL(request.url);
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  const branchIdParam = searchParams.get('branch_id');
  let fromDate = searchParams.get('from_date');
  let toDate = searchParams.get('to_date');
  const financialYear = searchParams.get('financial_year');

  if (!businessId) {
    return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  }
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
  }

  const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
  const accessCheck = await checkEmployeeAccessBoundary(userId, 'portal');
  if (!accessCheck.allowed) {
    return NextResponse.json({ error: accessCheck.reason, code: 'ACCESS_DENIED' }, { status: 403 });
  }

  try {
    await assertReportAccess(businessId, 'advanced');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return error.toNextResponse();
    }
    throw error;
  }

  // "ALL" or no branch = consolidated view (inter-branch accounts eliminated).
  const consolidated = !branchIdParam || branchIdParam === 'ALL' || branchIdParam === 'all';

  let finalBranchId: string | null = null;
  let branchInfo: any = null;
  let branch: BranchScope = { kind: 'all' };

  if (!consolidated) {
    const { resolveBranchId, isDefaultBranch } = await import('@/lib/branch-helpers');
    try {
      finalBranchId = await resolveBranchId({ branchId: branchIdParam, businessId });
      branchInfo = await queryOne(
        `SELECT id, name, branch_code, gstin
           FROM branches
          WHERE id = $1 AND business_id = $2 AND is_active = true`,
        [finalBranchId, businessId]
      );
      if (!branchInfo) {
        return NextResponse.json({ error: 'Branch not found or inactive' }, { status: 404 });
      }
      branch = {
        kind: 'branches',
        branchIds: [finalBranchId],
        // Business-level lines (opening balances, opening stock) carry no branch and belong to the default branch.
        includeUnbranched: await isDefaultBranch(finalBranchId, businessId),
      };
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }
  } else {
    const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
    const accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    if (accessibleBranchIds.length > 0) {
      branch = { kind: 'branches', branchIds: accessibleBranchIds, includeUnbranched: true };
    }
  }

  try {
    await authorize(userId, 'report.financial', 'read', {
      businessId,
      branchId: finalBranchId || undefined,
      resource: {
        business_id: businessId,
        branch_id: finalBranchId || undefined,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.toNextResponse();
    }
    throw error;
  }

  if (!fromDate || !toDate) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const fyStart = new Date(currentYear, 3, 1);
    if (!fromDate) {
      const startDate = now < fyStart ? new Date(currentYear - 1, 3, 1) : fyStart;
      fromDate = startDate.toISOString().split('T')[0];
    }
    if (!toDate) {
      toDate = now.toISOString().split('T')[0];
    }
  }

  return {
    businessId,
    userId,
    fromDate,
    toDate,
    financialYear,
    branch,
    consolidated,
    branchInfo: branchInfo
      ? { id: branchInfo.id, name: branchInfo.name, branch_code: branchInfo.branch_code, gstin: branchInfo.gstin }
      : null,
  };
}
