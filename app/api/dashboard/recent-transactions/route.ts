import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  parseRecentTxFilter,
  recentTransactionLikePattern,
  recentTransactionsSql,
} from '@/lib/dashboard/recent-transactions';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

/**
 * GET /api/dashboard/recent-transactions
 * Paged activity feed: invoices, purchases, payments, returns, expenses.
 * Query: kind, q, before (ISO time of the last row), before_id.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id required' }, { status: 400 });
    }

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('[recent-transactions] branch access', error);
      return NextResponse.json({ transactions: [], hasMore: false });
    }

    if (accessibleBranchIds.length === 0) {
      return NextResponse.json({ transactions: [], hasMore: false });
    }

    const filter = parseRecentTxFilter(searchParams.get('kind'));
    const like = recentTransactionLikePattern(searchParams.get('q') || '');
    const before = searchParams.get('before');
    const beforeId = searchParams.get('before_id');
    const hasCursor = Boolean(before && beforeId);

    const params: unknown[] = [businessId];
    let branchParam: number | null = null;
    if (accessibleBranchIds.length > 0) {
      params.push(accessibleBranchIds);
      branchParam = params.length;
    }
    let searchParam: number | null = null;
    if (like) {
      params.push(like);
      searchParam = params.length;
    }
    let cursorAtParam: number | null = null;
    let cursorIdParam: number | null = null;
    if (hasCursor) {
      params.push(before);
      cursorAtParam = params.length;
      params.push(beforeId);
      cursorIdParam = params.length;
    }
    params.push(PAGE_SIZE + 1);
    const limitParam = params.length;

    const rows = await queryRows(
      recentTransactionsSql({
        branchParam,
        searchParam,
        cursorAtParam,
        cursorIdParam,
        limitParam,
        filter,
      }),
      params
    );

    const hasMore = rows.length > PAGE_SIZE;
    const transactions = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return NextResponse.json({ transactions, hasMore });
  } catch (error: unknown) {
    console.error('Error fetching recent transactions:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
