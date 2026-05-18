import { NextRequest, NextResponse } from 'next/server';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import { queryRows, queryOne, query } from '@/lib/db';
import { Task } from '@/types/database';

/**
 * GET /api/tasks
 * List tasks
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        t.*,
        assignee.employee_code as assignee_code,
        assignee_user.name as assignee_name,
        assigner.employee_code as assigner_code,
        assigner_user.name as assigner_name
      FROM tasks t
      LEFT JOIN employees assignee ON t.assigned_to = assignee.id
      LEFT JOIN users assignee_user ON assignee.id = assignee_user.id
      LEFT JOIN employees assigner ON t.assigned_by = assigner.id
      LEFT JOIN users assigner_user ON assigner.id = assigner_user.id
      WHERE t.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND t.assigned_to = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (status) {
      sql += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (priority) {
      sql += ` AND t.priority = $${paramIndex}`;
      params.push(priority);
      paramIndex++;
    }

    sql += ` ORDER BY 
      CASE t.priority
        WHEN 'urgent' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      t.due_date ASC NULLS LAST,
      t.created_at DESC
    LIMIT 100`;

    const tasks = await queryRows<Task & {
      assignee_code?: string;
      assignee_name?: string;
      assigner_code?: string;
      assigner_name?: string;
    }>(sql, params);

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error('Error fetching tasks:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks
 * Create a new task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      title,
      description,
      assigned_to,
      assigned_by,
      priority = 'medium',
      due_date,
    } = body;

    if (!business_id || !title) {
      return NextResponse.json(
        { error: 'business_id and title are required' },
        { status: 400 }
      );
    }

    const taskLimit = await limitExceededResponse(business_id, 'employee_tasks');
    if (taskLimit) return taskLimit;

    const task = await queryOne<Task>(
      `INSERT INTO tasks (
        business_id, title, description, assigned_to, assigned_by, priority, due_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        business_id,
        title,
        description || null,
        assigned_to || null,
        assigned_by || null,
        priority,
        due_date || null,
      ]
    );

    return NextResponse.json({ task }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating task:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

