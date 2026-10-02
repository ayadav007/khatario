import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * Request context shared by the document-register reports (sales, purchases).
 *
 * Query params: from_date, to_date (YYYY-MM-DD, optional), branch_id (optional; ALL = all branches).
 * SQL placeholders built from it are fixed: $1 business, $2 from, $3 to, $4 branch.
 */
export interface ReportContext {
  businessId: string;
  userId: string;
  fromDate: string | null;
  toDate: string | null;
  branchId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const num = (v: unknown) => Number(v) || 0;

export async function resolveReportContext(request: NextRequest): Promise<ReportContext | NextResponse> {
  const { searchParams } = new URL(request.url);
  const businessId = getBusinessIdFromRequest(request);
  const userId = getUserIdFromRequest(request);
  const fromDate = searchParams.get('from_date') || null;
  const toDate = searchParams.get('to_date') || null;
  const branchIdParam = searchParams.get('branch_id');

  if (!businessId) return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
  if (!userId) return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
  if ((fromDate && !DATE_RE.test(fromDate)) || (toDate && !DATE_RE.test(toDate))) {
    return NextResponse.json({ error: 'from_date and to_date must be YYYY-MM-DD' }, { status: 400 });
  }
  if (fromDate && toDate && fromDate > toDate) {
    return NextResponse.json({ error: 'from_date must be on or before to_date' }, { status: 400 });
  }

  try {
    await assertReportAccess(businessId, 'basic');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }

  let branchId: string | null = null;
  if (branchIdParam && branchIdParam.toUpperCase() !== 'ALL') {
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    try {
      branchId = await resolveBranchId({ branchId: branchIdParam, businessId });
    } catch (error: any) {
      if (['BRANCH_NOT_FOUND', 'BRANCH_BUSINESS_MISMATCH', 'BRANCH_INACTIVE'].includes(error.code)) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  }

  try {
    await authorize(userId, 'report', 'read', {
      businessId,
      branchId: branchId ?? undefined,
      resource: { business_id: businessId, branch_id: branchId },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  return { businessId, userId, fromDate, toDate, branchId };
}

export const reportParams = (ctx: ReportContext) => [ctx.businessId, ctx.fromDate, ctx.toDate, ctx.branchId];

export const handleReportError = (label: string, error: any) => {
  console.error(`Error generating ${label}:`, error);
  return NextResponse.json({ error: 'Failed to generate report', details: error.message }, { status: 500 });
};

export function sumKeys<T extends Record<string, any>, K extends keyof T & string>(rows: T[], keys: readonly K[]) {
  return Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((s, row) => s + num(row[k]), 0))])) as Record<K, number>;
}
