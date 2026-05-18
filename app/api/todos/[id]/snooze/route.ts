import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requirePortalSession } from '@/lib/auth-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = await requirePortalSession(request);
  if (gate) return gate;

  try {
    const { id } = params;
    const body = await request.json();
    const { snooze_until, action_by } = body;

    if (!snooze_until) {
      return NextResponse.json({ error: 'Snooze until time is required' }, { status: 400 });
    }

    const todo = await queryOne('SELECT * FROM todos WHERE id = $1', [id]);
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
       WHERE id = $2
       RETURNING *`,
      [snooze_until, id]
    );

    await query(
      `SELECT create_todo_history($1, 'snoozed', $2, $3, $4)`,
      [id, todo.reminder_time?.toString() || null, snooze_until.toString(), action_by || null]
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
