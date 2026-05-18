import { NextRequest, NextResponse } from 'next/server';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  requirePortalSession,
} from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const business_id = getBusinessIdFromRequest(request);
    const user_id = getUserIdFromRequest(request);

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

    // Build WHERE clause
    const userIdParam = user_id && user_id.trim() !== '' ? user_id : null;
    const whereClause = userIdParam 
      ? 'business_id = $1 AND (assigned_to = $2 OR assigned_to IS NULL)'
      : 'business_id = $1';

    const params = userIdParam ? [business_id, userIdParam] : [business_id];

    // Auto-mark overdue (wrap in try-catch to avoid breaking the query)
    try {
      await queryOne('SELECT mark_overdue_todos()', []);
    } catch (error) {
      console.error('[GET /api/todos/stats] Error in mark_overdue_todos:', error);
      // Continue execution even if marking overdue fails
    }

    // Get counts for each view (use ::text to handle enum types)
    const [today, upcoming, overdue, highPriority] = await Promise.all([
      queryOne<{count: number}>(
        `SELECT COUNT(*) as count FROM todos 
         WHERE ${whereClause} 
         AND DATE(due_date) = CURRENT_DATE 
         AND status::text != 'completed'`,
        params
      ),
      queryOne<{count: number}>(
        `SELECT COUNT(*) as count FROM todos 
         WHERE ${whereClause} 
         AND due_date > NOW() 
         AND due_date <= NOW() + INTERVAL '7 days'
         AND status::text != 'completed'`,
        params
      ),
      queryOne<{count: number}>(
        `SELECT COUNT(*) as count FROM todos 
         WHERE ${whereClause} 
         AND status::text IN ('pending', 'in_progress', 'overdue')
         AND (due_date + INTERVAL '1 minute' <= NOW() OR status::text = 'overdue')`,
        params
      ),
      queryOne<{count: number}>(
        `SELECT COUNT(*) as count FROM todos 
         WHERE ${whereClause} 
         AND priority::text = 'high' 
         AND status::text != 'completed'`,
        params
      )
    ]);

    return NextResponse.json({
      today: parseInt(String(today?.count || '0')),
      upcoming: parseInt(String(upcoming?.count || '0')),
      overdue: parseInt(String(overdue?.count || '0')),
      high_priority: parseInt(String(highPriority?.count || '0'))
    });
  } catch (error: any) {
    console.error('[GET /api/todos/stats] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

