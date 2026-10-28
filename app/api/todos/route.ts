import { NextRequest, NextResponse } from 'next/server';
import { requireStrictSession } from '@/lib/auth-helpers';
import { queryRows, getPool } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { computeSmartReminderUtc } from '@/lib/todo-reminder-defaults';
import {
  TodoInputError,
  TODO_PRIORITIES,
  TODO_REMINDER_TYPES,
  checkAssignee,
  checkChannels,
  checkInstant,
  checkOneOf,
  checkRelatedEntity,
  checkTitle,
  isUuid,
} from '@/lib/todo-input';

export const dynamic = 'force-dynamic';

interface GetTodosQuery {
  business_id: string;
  user_id?: string;
  view?: 'today' | 'upcoming' | 'overdue' | 'completed' | 'high_priority';
  status?: 'pending' | 'in_progress' | 'completed' | 'overdue';
  priority?: 'low' | 'medium' | 'high';
  assigned_to?: string;
  related_entity_type?: string;
  related_entity_id?: string;
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    const { searchParams } = new URL(request.url);
    const business_id = session.businessId;
    const user_id = session.userId;
    const view = searchParams.get('view') as GetTodosQuery['view'];
    const status = searchParams.get('status') as GetTodosQuery['status'];
    const priority = searchParams.get('priority') as GetTodosQuery['priority'];
    const assigned_to = searchParams.get('assigned_to');
    const related_entity_type = searchParams.get('related_entity_type');
    const related_entity_id = searchParams.get('related_entity_id');
    const due_from = searchParams.get('due_from');
    const due_to = searchParams.get('due_to');

    // Check Todo feature access
    try {
      await assertFeatureAccess(business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Build WHERE clause dynamically
    let whereConditions = ['business_id = $1'];
    const params: any[] = [business_id];
    let paramIndex = 2;

    // Handle assigned_to filter (show todos assigned to user OR unassigned)
    const userIdParam = user_id && user_id.trim() !== '' ? user_id : null;
    if (userIdParam) {
      whereConditions.push(`(assigned_to = $${paramIndex} OR assigned_to IS NULL)`);
      params.push(userIdParam);
      paramIndex++;
    }

    // Date range (e.g. calendar month in a specific TZ, bounds as ISO UTC) — includes completed.
    const useDateRange = Boolean(due_from && due_to);

    if (useDateRange) {
      whereConditions.push(`due_date >= $${paramIndex}::timestamptz`);
      params.push(due_from);
      paramIndex++;
      whereConditions.push(`due_date < $${paramIndex}::timestamptz`);
      params.push(due_to);
      paramIndex++;
    } else if (view === 'today') {
      whereConditions.push(`DATE(due_date) = CURRENT_DATE`);
      whereConditions.push(`status::text != 'completed'`);
    } else if (view === 'upcoming') {
      whereConditions.push(`due_date > NOW()`);
      whereConditions.push(`due_date <= NOW() + INTERVAL '7 days'`);
      whereConditions.push(`status::text != 'completed'`);
    } else if (view === 'overdue') {
      whereConditions.push(
        `(status::text IN ('pending', 'in_progress', 'overdue') AND (due_date + INTERVAL '1 minute' <= NOW() OR status::text = 'overdue'))`
      );
    } else if (view === 'completed') {
      whereConditions.push(`status::text = 'completed'`);
    } else if (view === 'high_priority') {
      whereConditions.push(`priority::text = 'high'`);
      whereConditions.push(`status::text != 'completed'`);
    }

    // Status filter (use ::text to handle enum types)
    if (status) {
      whereConditions.push(`status::text = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    // Priority filter (use ::text to handle enum types)
    if (priority) {
      whereConditions.push(`priority::text = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    if ((assigned_to && !isUuid(assigned_to)) || (related_entity_id && !isUuid(related_entity_id))) {
      return NextResponse.json({ error: 'assigned_to and related_entity_id must be valid ids' }, { status: 400 });
    }

    // Assigned to filter
    if (assigned_to) {
      whereConditions.push(`assigned_to = $${paramIndex}`);
      params.push(assigned_to);
      paramIndex++;
    }

    // Related entity filter
    if (related_entity_type) {
      whereConditions.push(`related_entity_type = $${paramIndex}`);
      params.push(related_entity_type);
      paramIndex++;
      
      if (related_entity_id) {
        whereConditions.push(`related_entity_id = $${paramIndex}`);
        params.push(related_entity_id);
        paramIndex++;
      }
    }

    const whereClause = whereConditions.join(' AND ');

    // Auto-mark overdue todos before fetching (wrap in try-catch to avoid breaking the query)
    try {
      await queryRows('SELECT mark_overdue_todos()', []);
    } catch (error) {
      console.error('[GET /api/todos] Error in mark_overdue_todos:', error);
      // Continue execution even if marking overdue fails
    }

    // Build ORDER BY clause that handles both enum and text status
    const todos = await queryRows(
      `SELECT * FROM todos 
       WHERE ${whereClause}
       ORDER BY 
         CASE WHEN status::text = 'overdue' THEN 0 ELSE 1 END,
         CASE 
           WHEN status::text = 'pending' THEN 0 
           WHEN status::text = 'in_progress' THEN 1 
           ELSE 2 
         END,
         CASE priority::text WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         due_date ASC NULLS LAST,
         created_at DESC`,
      params
    );

    return NextResponse.json(todos);
  } catch (error: any) {
    console.error('[GET /api/todos] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Business and creator come from the session only; body business_id / created_by are ignored.
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const business_id = session.businessId;
    const created_by = session.userId;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (body.business_id && body.business_id !== business_id) {
      return NextResponse.json({ error: 'Business ID does not match your session' }, { status: 403 });
    }

    // Check Todo feature access
    try {
      await assertFeatureAccess(business_id, 'todo');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let fields;
    try {
      const title = checkTitle(body.title);
      if (body.due_date == null || body.due_date === '') {
        throw new TodoInputError('Due date is required');
      }
      const due_date = checkInstant('due_date', body.due_date);
      const priority = body.priority == null || body.priority === ''
        ? 'medium'
        : checkOneOf('priority', body.priority, TODO_PRIORITIES);
      const reminder_type = body.reminder_type == null || body.reminder_type === ''
        ? 'once'
        : checkOneOf('reminder_type', body.reminder_type, TODO_REMINDER_TYPES);
      let reminder_time: string | null = null;
      if (reminder_type !== 'none') {
        reminder_time = body.reminder_time == null || body.reminder_time === ''
          // Same default the Todo page uses when no reminder time is picked
          ? computeSmartReminderUtc(new Date(due_date), new Date()).toISOString()
          : checkInstant('reminder_time', body.reminder_time);
      }
      const reminder_channels = body.reminder_channels == null
        ? ['in_app']
        : checkChannels(body.reminder_channels);
      const related = checkRelatedEntity(body.related_entity_type, body.related_entity_id);
      if (body.description != null && typeof body.description !== 'string') {
        throw new TodoInputError('description must be text');
      }
      const assigned_to = await checkAssignee(business_id, body.assigned_to);
      fields = {
        title,
        description: (body.description as string | undefined) || null,
        due_date,
        priority,
        reminder_type,
        reminder_time,
        reminder_channels,
        related,
        assigned_to,
      };
    } catch (error) {
      if (error instanceof TodoInputError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Todo and its "created" history row are written together, so a failure leaves neither.
    const client = await getPool().connect();
    let newTodo: any;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO todos (
          business_id, 
          assigned_to,
          title, 
          description, 
          due_date, 
          priority, 
          reminder_type,
          reminder_time,
          reminder_channels,
          related_entity_type,
          related_entity_id,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
        RETURNING *`,
        [
          business_id,
          fields.assigned_to,
          fields.title,
          fields.description,
          fields.due_date,
          fields.priority,
          fields.reminder_type,
          fields.reminder_time,
          fields.reminder_channels,
          fields.related.type,
          fields.related.id,
          created_by
        ]
      );
      newTodo = inserted.rows[0];
      await client.query(
        `SELECT create_todo_history($1, 'created', NULL, $2, $3)`,
        [newTodo.id, fields.title, created_by]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // Schedule reminder (feature access was checked above)
    if (newTodo.reminder_type !== 'none' && newTodo.reminder_time) {
      try {
        const { scheduleTodoReminder } = await import('@/lib/queue/todoReminderQueue');
        await scheduleTodoReminder(newTodo.id, new Date(newTodo.reminder_time));
      } catch (error) {
        console.error('[POST /api/todos] Failed to schedule reminder:', error);
        // Don't fail todo creation if reminder scheduling fails
      }
    }

    return NextResponse.json(newTodo);
  } catch (error: any) {
    console.error('[POST /api/todos] Error:', error);
    return NextResponse.json({ error: 'Failed to create todo' }, { status: 500 });
  }
}
