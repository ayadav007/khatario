import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { loadTaskBundle } from '@/lib/hr/recruitment/onboarding/task-service';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; taskId: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'read', { businessId, resourceId: params.id });

    const candidate = await queryOne<{ id: string; full_name: string; email: string; status: string }>(
      `SELECT id, full_name, email, status FROM recruitment_candidates
       WHERE id = $1 AND business_id = $2`,
      [params.id, businessId],
    );
    if (!candidate) return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });

    const bundle = await loadTaskBundle(params.taskId, params.id, businessId);
    if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

    return NextResponse.json({ candidate, ...bundle });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[hr task GET]', error);
    return NextResponse.json({ error: 'Failed to load task' }, { status: 500 });
  }
}
