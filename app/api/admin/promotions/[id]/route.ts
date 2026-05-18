import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/promotions/[id]
 * Get single promotion details (Admin only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const id = params.id;

    const promotion = await queryOne(`
      SELECT p.*, 
        COUNT(v.viewed_at) as view_count,
        COUNT(v.clicked_at) as click_count,
        COUNT(v.dismissed_at) as dismiss_count
      FROM platform_promotions p
      LEFT JOIN promotion_views v ON p.id = v.promotion_id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);

    if (!promotion) {
      return NextResponse.json({ error: 'Promotion not found' }, { status: 404 });
    }

    return NextResponse.json({ promotion });
  } catch (error: any) {
    console.error('Error fetching promotion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/promotions/[id]
 * Update promotion (Admin only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { admin_id: _ignored, ...updates } = body;
    const id = params.id;

    const asTimestamptzOrNull = (v: unknown): string | null | undefined => {
      if (v === '' || v === undefined) return null;
      if (v === null) return null;
      return v as string;
    };

    const setClauses: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'topbar_image_urls' && (Array.isArray(value) || value === null)) {
        setClauses.push(`topbar_image_urls = $${i++}::jsonb`);
        values.push(
          value === null
            ? '[]'
            : JSON.stringify(
                (value as string[]).filter((u) => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim())
              )
        );
        continue;
      }
      if (key === 'carousel_image_urls' && (Array.isArray(value) || value === null)) {
        setClauses.push(`carousel_image_urls = $${i++}::jsonb`);
        values.push(
          value === null
            ? '[]'
            : JSON.stringify(
                (value as string[]).filter((u) => typeof u === 'string' && u.trim().length > 0).map((u) => u.trim())
              )
        );
        continue;
      }
      if (['title', 'description', 'message_type', 'image_url', 'button_text', 'button_url', 
           'button_action', 'display_position', 'priority', 'is_active', 'target_audience', 
           'target_plan_ids', 'exclude_business_ids', 'start_date', 'end_date', 
           'background_color', 'text_color', 'dismissible', 'show_once_per_business',
           'topbar_mode', 'topbar_carousel_interval_ms', 'carousel_advance_ms'].includes(key)) {
        setClauses.push(`${key} = $${i++}`);
        if (key === 'start_date' || key === 'end_date') {
          values.push(asTimestamptzOrNull(value));
        } else if (key === 'image_url' && value === '') {
          values.push(null);
        } else {
          values.push(value);
        }
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    values.push(id);
    const promotion = await queryOne(
      `UPDATE platform_promotions 
       SET ${setClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${i}
       RETURNING *`,
      values
    );

    return NextResponse.json({ promotion });
  } catch (error: any) {
    console.error('Error updating promotion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/promotions/[id]
 * Delete promotion (Admin only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const id = params.id;

    await query('DELETE FROM platform_promotions WHERE id = $1', [id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting promotion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

