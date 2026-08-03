import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { importLeaveBalancesCsv } from '@/lib/hr/leave/leave-bulk-import';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'leave_requests', 'update', { businessId });

    const body = await request.json();
    const csvText = body.csv ?? body.content;
    if (!csvText || typeof csvText !== 'string') {
      return NextResponse.json({ error: 'csv content is required' }, { status: 400 });
    }

    const result = await importLeaveBalancesCsv(
      businessId,
      csvText,
      body.year != null ? Number(body.year) : undefined,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Import failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
