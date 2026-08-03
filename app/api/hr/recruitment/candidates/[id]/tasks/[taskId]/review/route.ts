import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { reviewTask } from '@/lib/hr/recruitment/onboarding/task-service';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });

    const body = await request.json();
    const action = body?.action === 'request_changes' ? 'request_changes' : 'approve';
    const notes = body?.notes ? String(body.notes) : undefined;

    await reviewTask({
      taskId: params.taskId,
      businessId,
      candidateId: params.id,
      reviewerId: userId,
      action,
      notes,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[task review]', error);
    return NextResponse.json({ error: 'Failed to review task' }, { status: 500 });
  }
}
