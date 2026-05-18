import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

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
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const user_id = getUserIdFromRequest(request);
    const view = searchParams.get('view') as GetTodosQuery['view'];
    const status = searchParams.get('status') as GetTodosQuery['status'];
    const priority = searchParams.get('priority') as GetTodosQuery['priority'];
    const assigned_to = searchParams.get('assigned_to');
    const related_entity_type = searchParams.get('related_entity_type');
    const related_entity_id = searchParams.get('related_entity_id');
    const due_from = searchParams.get('due_from');
    const due_to = searchParams.get('due_to');

    if (!business_id) {
      return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
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
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const body = await request.json();
    const { 
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
    } = body;

    if (!business_id || !title || !due_date) {
      return NextResponse.json({ 
        error: 'Business ID, Title, and Due Date are required' 
      }, { status: 400 });
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

    // Set default reminder_time if not provided but reminder_type is set
    let finalReminderTime = reminder_time;
    if (reminder_type && reminder_type !== 'none' && !reminder_time) {
      // Default: 1 hour before due date
      const dueDate = new Date(due_date);
      dueDate.setHours(dueDate.getHours() - 1);
      finalReminderTime = dueDate.toISOString();
    }

    const newTodo = await queryOne(
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
        assigned_to || null,
        title, 
        description || null, 
        due_date, 
        priority || 'medium', 
        reminder_type || 'once',
        finalReminderTime || null,
        reminder_channels || ['in_app'],
        related_entity_type || null,
        related_entity_id || null,
        created_by || null
      ]
    );

    // Create history entry
    if (newTodo) {
      await query(
        `SELECT create_todo_history($1, 'created', NULL, $2, $3)`,
        [newTodo.id, title, created_by || null]
      );
    }

    // Schedule reminder if Todo feature is enabled
    if (newTodo && newTodo.reminder_type && newTodo.reminder_type !== 'none' && newTodo.reminder_time) {
      try {
        const { hasFeatureAccess } = await import('@/lib/subscription/feature-access');
        const hasAccess = await hasFeatureAccess(business_id, 'todo');
        
        if (hasAccess) {
          const { scheduleTodoReminder } = await import('@/lib/queue/todoReminderQueue');
          await scheduleTodoReminder(newTodo.id, new Date(newTodo.reminder_time));
        } else {
          console.log('[POST /api/todos] Todo feature disabled, skipping reminder scheduling');
        }
      } catch (error) {
        console.error('[POST /api/todos] Failed to schedule reminder:', error);
        // Don't fail todo creation if reminder scheduling fails
      }
    }

    return NextResponse.json(newTodo);
  } catch (error: any) {
    console.error('[POST /api/todos] Error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to create todo',
      details: error.detail
    }, { status: 500 });
  }
}
