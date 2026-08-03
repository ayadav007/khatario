import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { fetchEmployeeTasks } from '@/lib/employee-portal/portal-dashboard';
import { requirePortalSession } from '@/lib/employee-portal/portal-route-guard';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const tasks = await fetchEmployeeTasks(auth.session.businessId, auth.session.employeeId);
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('[portal/tasks GET]', error);
    return NextResponse.json({ error: 'Failed to load tasks' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
    }

    const task = await queryOne<{ id: string }>(
      `INSERT INTO tasks (business_id, title, description, assigned_to, assigned_by, status, priority)
       VALUES ($1, $2, $3, $4, $4, 'pending', 'medium')
       RETURNING id`,
      [
        auth.session.businessId,
        title,
        body?.description ? String(body.description) : null,
        auth.session.employeeId,
      ],
    );

    return NextResponse.json({ ok: true, id: task?.id });
  } catch (error) {
    console.error('[portal/tasks POST]', error);
    return NextResponse.json({ error: 'Failed to create task' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requirePortalSession(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const taskId = String(body?.id ?? '');
    const status = String(body?.status ?? '');
    if (!taskId || !['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return NextResponse.json({ error: 'Invalid task update' }, { status: 400 });
    }

    const owned = await queryOne(
      `SELECT id FROM tasks WHERE id = $1 AND business_id = $2 AND assigned_to = $3`,
      [taskId, auth.session.businessId, auth.session.employeeId],
    );
    if (!owned) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    await query(
      `UPDATE tasks SET status = $1,
         completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, taskId],
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[portal/tasks PATCH]', error);
    return NextResponse.json({ error: 'Failed to update task' }, { status: 500 });
  }
}
