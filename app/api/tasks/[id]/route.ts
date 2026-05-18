import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { Task } from '@/types/database';

/**
 * PATCH /api/tasks/[id]
 * Update a task
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify task belongs to business
    const existing = await queryOne(
      'SELECT id FROM tasks WHERE id = $1 AND business_id = $2',
      [taskId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    const {
      title,
      description,
      assigned_to,
      status,
      priority,
      due_date,
    } = body;

    const updates: string[] = [];
    const queryParams: any[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      queryParams.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      queryParams.push(description || null);
    }
    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex++}`);
      queryParams.push(assigned_to || null);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      queryParams.push(status);
      if (status === 'completed') {
        updates.push(`completed_at = CURRENT_TIMESTAMP`);
      } else if (status !== 'completed') {
        updates.push(`completed_at = NULL`);
      }
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      queryParams.push(priority);
    }
    if (due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      queryParams.push(due_date || null);
    }

    if (updates.length > 0) {
      queryParams.push(taskId);
      await query(
        `UPDATE tasks SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex}`,
        queryParams
      );
    }

    const updated = await queryOne<Task>(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    return NextResponse.json({ task: updated });
  } catch (error: any) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/tasks/[id]
 * Delete a task
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const taskId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Verify task belongs to business
    const existing = await queryOne(
      'SELECT id FROM tasks WHERE id = $1 AND business_id = $2',
      [taskId, businessId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    await query('DELETE FROM tasks WHERE id = $1', [taskId]);

    return NextResponse.json({ message: 'Task deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting task:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

