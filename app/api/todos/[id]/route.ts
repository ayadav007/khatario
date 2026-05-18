import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requirePortalSession } from '@/lib/auth-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { id } = params;
    
    // Get todo with history
    const todo = await queryOne(
      `SELECT * FROM todos WHERE id = $1`,
      [id]
    );

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
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { id } = params;
    const body = await request.json();
    const { 
      title, 
      description, 
      due_date, 
      priority, 
      status,
      reminder_type,
      reminder_time,
      reminder_channels,
      assigned_to,
      action_by,
      reason // For rescheduling
    } = body;

    // Get current todo to compare changes
    const currentTodo = await queryOne('SELECT * FROM todos WHERE id = $1', [id]);
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
      values.push(description);
    }
    
    if (due_date !== undefined) {
      const oldDueDate = currentTodo.due_date;
      const newDueDate = due_date;
      if (oldDueDate !== newDueDate) {
        fields.push(`due_date = $${paramIndex++}`);
        values.push(newDueDate);
        historyEntries.push({ 
          action: 'rescheduled', 
          old_val: oldDueDate, 
          new_val: newDueDate,
          old_due: oldDueDate,
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
      } else if (currentTodo.status === 'completed' && status !== 'completed') {
        fields.push(`completed_at = NULL`);
      }
      historyEntries.push({ action: 'status_changed', old_val: currentTodo.status, new_val: status });
    }
    
    if (reminder_type !== undefined) {
      fields.push(`reminder_type = $${paramIndex++}`);
      values.push(reminder_type);
      if (reminder_type === 'none') {
        fields.push(`reminder_time = NULL`);
      }
    }
    
    if (reminder_time !== undefined) {
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
      values.push(assigned_to || null);
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    values.push(id);
    const updatedTodo = await queryOne(
      `UPDATE todos SET ${fields.join(', ')}, updated_at = NOW() 
       WHERE id = $${paramIndex} 
       RETURNING *`,
      values
    );

    // Create history entries
    for (const entry of historyEntries) {
      await query(
        `SELECT create_todo_history($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          entry.action,
          entry.old_val?.toString() || null,
          entry.new_val?.toString() || null,
          action_by || null,
          entry.old_due || null,
          entry.new_due || null,
          reason || null
        ]
      );
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { id } = params;
    
    // Get todo to check feature access
    const todo = await queryOne('SELECT * FROM todos WHERE id = $1', [id]);
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
      'UPDATE todos SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      ['completed', id]
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
