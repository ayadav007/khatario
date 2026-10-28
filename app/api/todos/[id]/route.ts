import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requireStrictSession } from '@/lib/auth-helpers';
import { computeSmartReminderUtc } from '@/lib/todo-reminder-defaults';
import {
  TodoInputError,
  TODO_PRIORITIES,
  TODO_REMINDER_TYPES,
  TODO_STATUSES,
  checkAssignee,
  checkChannels,
  checkInstant,
  checkOneOf,
  checkTitle,
  isUuid,
} from '@/lib/todo-input';

/** The todo, only when it belongs to the session's business (otherwise treated as not found). */
async function findSessionTodo(id: string, businessId: string) {
  if (!isUuid(id)) return null;
  return queryOne('SELECT * FROM todos WHERE id = $1 AND business_id = $2', [id, businessId]);
}

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    const { id } = params;
    
    // Get todo with history
    const todo = await findSessionTodo(id, session.businessId);

    if (!todo) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }

    // Check Todo feature access
    try {
      await assertFeatureAccess(todo.business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get history
    const history = await queryRows(
      `SELECT * FROM todo_history 
       WHERE todo_id = $1 
       ORDER BY action_date DESC`,
      [id]
    );

    return NextResponse.json({ todo, history });
  } catch (error: any) {
    console.error('[GET /api/todos/:id] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    const { id } = params;
    let body: Record<string, any>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { 
      description, 
      reason // For rescheduling
    } = body;
    // History is recorded against the signed-in user, never a body action_by.
    const action_by = session.userId;

    // Get current todo to compare changes
    const currentTodo = await findSessionTodo(id, session.businessId);
    if (!currentTodo) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }

    // Check Todo feature access
    try {
      await assertFeatureAccess(currentTodo.business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let title, due_date, priority, status, reminder_type, reminder_time, reminder_channels, assigned_to;
    try {
      if (body.title !== undefined) title = checkTitle(body.title);
      if (body.due_date !== undefined) due_date = checkInstant('due_date', body.due_date);
      if (body.priority !== undefined) priority = checkOneOf('priority', body.priority, TODO_PRIORITIES);
      if (body.status !== undefined) status = checkOneOf('status', body.status, TODO_STATUSES);
      if (body.reminder_type !== undefined) {
        reminder_type = checkOneOf('reminder_type', body.reminder_type, TODO_REMINDER_TYPES);
      }
      if (body.reminder_time !== undefined && body.reminder_time !== null && body.reminder_time !== '') {
        reminder_time = checkInstant('reminder_time', body.reminder_time);
      }
      if (body.reminder_channels !== undefined) reminder_channels = checkChannels(body.reminder_channels);
      if (description !== undefined && description !== null && typeof description !== 'string') {
        throw new TodoInputError('description must be text');
      }
      if (body.assigned_to !== undefined) {
        assigned_to = await checkAssignee(session.businessId, body.assigned_to);
      }
    } catch (error) {
      if (error instanceof TodoInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // A reminder needs a time: turning reminders on without one gets the Todo page's smart default.
    const effectiveType = reminder_type ?? currentTodo.reminder_type;
    if (
      reminder_type !== undefined &&
      reminder_type !== 'none' &&
      reminder_time === undefined &&
      !currentTodo.reminder_time
    ) {
      const due = new Date(due_date ?? currentTodo.due_date);
      reminder_time = computeSmartReminderUtc(due, new Date()).toISOString();
    }

    // Build update query dynamically
    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;
    const historyEntries: Array<{action: string, old_val: any, new_val: any, old_due?: string, new_due?: string}> = [];

    if (title !== undefined && title !== currentTodo.title) {
      fields.push(`title = $${paramIndex++}`);
      values.push(title);
      historyEntries.push({ action: 'title_changed', old_val: currentTodo.title, new_val: title });
    }
    
    if (description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(description || null);
    }
    
    if (due_date !== undefined) {
      const oldDueDate = currentTodo.due_date ? new Date(currentTodo.due_date).toISOString() : null;
      const newDueDate = due_date;
      if (oldDueDate !== newDueDate) {
        fields.push(`due_date = $${paramIndex++}`);
        values.push(newDueDate);
        historyEntries.push({ 
          action: 'rescheduled', 
          old_val: oldDueDate, 
          new_val: newDueDate,
          old_due: oldDueDate ?? undefined,
          new_due: newDueDate
        });
      }
    }
    
    if (priority !== undefined && priority !== currentTodo.priority) {
      fields.push(`priority = $${paramIndex++}`);
      values.push(priority);
      historyEntries.push({ action: 'priority_changed', old_val: currentTodo.priority, new_val: priority });
    }
    
    if (status !== undefined && status !== currentTodo.status) {
      fields.push(`status = $${paramIndex++}`);
      values.push(status);
      if (status === 'completed') {
        fields.push(`completed_at = NOW()`);
      } else if (currentTodo.status === 'completed') {
        fields.push(`completed_at = NULL`);
      }
      historyEntries.push({ action: 'status_changed', old_val: currentTodo.status, new_val: status });
    }
    
    if (reminder_type !== undefined) {
      fields.push(`reminder_type = $${paramIndex++}`);
      values.push(reminder_type);
    }
    
    if (effectiveType === 'none') {
      if (reminder_type !== undefined) fields.push(`reminder_time = NULL`);
    } else if (reminder_time !== undefined) {
      fields.push(`reminder_time = $${paramIndex++}`);
      values.push(reminder_time);
      fields.push(`reminder_sent = false`); // Reset reminder when time changes
    }
    
    if (reminder_channels !== undefined) {
      fields.push(`reminder_channels = $${paramIndex++}`);
      values.push(reminder_channels);
    }
    
    if (assigned_to !== undefined) {
      fields.push(`assigned_to = $${paramIndex++}`);
      values.push(assigned_to);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Update and its history rows are written together.
    const client = await getPool().connect();
    let updatedTodo: any;
    try {
      await client.query('BEGIN');
      values.push(id, session.businessId);
      const updated = await client.query(
        `UPDATE todos SET ${fields.join(', ')}, updated_at = NOW() 
         WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
         RETURNING *`,
        values
      );
      updatedTodo = updated.rows[0];

      for (const entry of historyEntries) {
        await client.query(
          `SELECT create_todo_history($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            entry.action,
            entry.old_val?.toString() || null,
            entry.new_val?.toString() || null,
            action_by,
            entry.old_due || null,
            entry.new_due || null,
            reason || null
          ]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // Keep BullMQ delayed job in sync with DB (exact-time reminders via worker + Redis → SSE)
    try {
      const { syncTodoReminderJobAfterUpdate } = await import('@/lib/queue/syncTodoReminderJob');
      await syncTodoReminderJobAfterUpdate(id, currentTodo.business_id, updatedTodo);
    } catch (error) {
      console.error('[PATCH /api/todos/:id] Failed to sync reminder queue:', error);
    }

    return NextResponse.json(updatedTodo);
  } catch (error: any) {
    console.error('[PATCH /api/todos/:id] Error:', error);
    return NextResponse.json({ error: 'Failed to update todo' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    const { id } = params;
    
    // Get todo to check feature access
    const todo = await findSessionTodo(id, session.businessId);
    if (!todo) {
      return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
    }

    // Check Todo feature access
    try {
      await assertFeatureAccess(todo.business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }
    
    // Don't actually delete - mark as cancelled or just soft delete by updating status
    // For now, we'll just mark as completed and keep history
    const deleted = await queryOne(
      'UPDATE todos SET status = $1, updated_at = NOW() WHERE id = $2 AND business_id = $3 RETURNING id',
      ['completed', id, session.businessId]
    );

    if (deleted) {
      try {
        const { cancelScheduledTodoReminder } = await import('@/lib/queue/todoReminderQueue');
        await cancelScheduledTodoReminder(id);
      } catch (e) {
        console.warn('[DELETE /api/todos/:id] cancel reminder job:', e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[DELETE /api/todos/:id] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
