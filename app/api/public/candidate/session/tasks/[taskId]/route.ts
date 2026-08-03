import { NextRequest, NextResponse } from 'next/server';
import { getCandidatePortalSessionFromRequest } from '@/lib/hr/recruitment/candidate-portal-session';
import {
  loadTaskBundle,
  markTaskInProgress,
  submitTask,
} from '@/lib/hr/recruitment/onboarding/task-service';
import { isTaskEditable } from '@/lib/hr/recruitment/onboarding/validation';
import { CANDIDATE_SELF_STATUSES } from '@/lib/hr/recruitment/onboarding/types';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type RouteParams = { params: { taskId: string } };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bundle = await loadTaskBundle(params.taskId, session.candidate_id, session.business_id);
  if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  return NextResponse.json({
    ...bundle,
    editable: isTaskEditable(bundle.task.status),
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getCandidatePortalSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const bundle = await loadTaskBundle(params.taskId, session.candidate_id, session.business_id);
  if (!bundle) return NextResponse.json({ error: 'Task not found' }, { status: 404 });

  const body = await request.json();

  if (body.candidate_self_status !== undefined) {
    const selfStatus = String(body.candidate_self_status);
    if (!CANDIDATE_SELF_STATUSES.includes(selfStatus as never)) {
      return NextResponse.json({ error: 'Invalid self status' }, { status: 400 });
    }
    await query(
      `UPDATE candidate_onboarding_tasks
       SET candidate_self_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND candidate_id = $3`,
      [selfStatus, params.taskId, session.candidate_id],
    );
    if (selfStatus === 'in_progress') await markTaskInProgress(params.taskId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'submit') {
    const result = await submitTask(params.taskId, session.candidate_id, session.business_id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unsupported update' }, { status: 400 });
}
