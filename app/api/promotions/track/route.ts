import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/promotions/track
 * Tracks user interaction with a promotion (view, click, dismiss)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { promotion_id, business_id, action } = body;

    if (!promotion_id || !business_id || !action) {
      return NextResponse.json(
        { error: 'promotion_id, business_id, and action are required' },
        { status: 400 }
      );
    }

    if (!['view', 'click', 'dismiss'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be view, click, or dismiss' },
        { status: 400 }
      );
    }

    const timestampField = action === 'view' ? 'viewed_at' : action === 'click' ? 'clicked_at' : 'dismissed_at';

    // Use UPSERT to handle existing or new tracking records
    await query(`
      INSERT INTO promotion_views (promotion_id, business_id, ${timestampField})
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (promotion_id, business_id)
      DO UPDATE SET ${timestampField} = CURRENT_TIMESTAMP
    `, [promotion_id, business_id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error tracking promotion interaction:', error);
    return NextResponse.json(
      { error: 'Failed to track interaction', details: error.message },
      { status: 500 }
    );
  }
}

