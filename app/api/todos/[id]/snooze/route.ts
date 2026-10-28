import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requireStrictSession } from '@/lib/auth-helpers';
import { checkInstant, isUuid, TodoInputError } from '@/lib/todo-input';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;

  try {
    const { id } = params;
    const body = await request.json().catch(() => null);
    if (!body?.snooze_until) {
      return NextResponse.json({ error: 'Snooze until time is required' }, { status: 400 });
    }
    let snooze_until: string;
    try {
      snooze_until = checkInstant('snooze_until', body.snooze_until);
    } catch (error) {
      if (error instanceof TodoInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const todo = isUuid(id)
      ? await queryOne('SELECT * FROM todos WHERE id = $1 AND business_id = $2', [id, session.businessId])
      : null;
    if (!todo) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }

    try {
      await assertFeatureAccess(todo.business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const updatedTodo = await queryOne(
      `UPDATE todos
       SET reminder_time = $1,
           reminder_sent = false,
           updated_at = NOW()
       WHERE id = $2 AND business_id = $3
       RETURNING *`,
      [snooze_until, id, session.businessId]
    );

    await query(
      `SELECT create_todo_history($1, 'snoozed', $2, $3, $4)`,
      [id, todo.reminder_time?.toString() || null, snooze_until, session.userId]
    );

    try {
      const { syncTodoReminderJobAfterUpdate } = await import('@/lib/queue/syncTodoReminderJob');
      await syncTodoReminderJobAfterUpdate(
        id,
        todo.business_id,
        updatedTodo
      );
    } catch (err) {
      console.error('[POST /api/todos/:id/snooze] Failed to sync reminder queue:', err);
    }

    return NextResponse.json(updatedTodo);
  } catch (error: any) {
    console.error('[POST /api/todos/:id/snooze] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
