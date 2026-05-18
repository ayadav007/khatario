import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/promotions?status=all&type=banner
 * List all promotions with basic stats (Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';
    const type = searchParams.get('type');

    let sql = `
      SELECT p.*, 
        COUNT(v.viewed_at) as view_count,
        COUNT(v.clicked_at) as click_count,
        COUNT(v.dismissed_at) as dismiss_count
      FROM platform_promotions p
      LEFT JOIN promotion_views v ON p.id = v.promotion_id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (status === 'active') {
      sql += ` AND p.is_active = true AND (p.end_date IS NULL OR p.end_date >= CURRENT_TIMESTAMP)`;
    } else if (status === 'inactive') {
      sql += ` AND (p.is_active = false OR p.end_date < CURRENT_TIMESTAMP)`;
    }

    if (type) {
      sql += ` AND p.message_type = $${params.length + 1}`;
      params.push(type);
    }

    sql += ` GROUP BY p.id ORDER BY p.created_at DESC`;

    const promotions = await queryRows(sql, params);

    return NextResponse.json({ promotions });
  } catch (error: any) {
    console.error('Error listing promotions:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to list promotions' },
      { status: error.message?.includes('Insufficient') ? 403 : 500 }
    );
  }
}

/**
 * POST /api/admin/promotions
 * Create a new promotion (Admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'admin');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const { admin_id: _ignored, ...data } = body;

    const admin = auth.admin;

    const {
      title, description, message_type, image_url,
      button_text, button_url, button_action,
      display_position, priority, is_active,
      target_audience, target_plan_ids, exclude_business_ids,
      start_date, end_date, background_color, text_color,
      dismissible, show_once_per_business,
      topbar_mode, topbar_image_urls, topbar_carousel_interval_ms,
      carousel_image_urls, carousel_advance_ms,
    } = data;

    if (!title || !message_type) {
      return NextResponse.json({ error: 'Title and Type are required' }, { status: 400 });
    }

    const topbarMode = topbar_mode === 'vertical_carousel' ? 'vertical_carousel' : 'single';
    const rawUrls = Array.isArray(topbar_image_urls) ? topbar_image_urls : [];
    const topbarUrlsJson = JSON.stringify(
      rawUrls.filter((u: string) => typeof u === 'string' && u.trim().length > 0).map((u: string) => u.trim())
    );
    const topbarInterval =
      typeof topbar_carousel_interval_ms === 'number' && topbar_carousel_interval_ms >= 2000
        ? Math.min(topbar_carousel_interval_ms, 120000)
        : 5000;

    const rawCarousel = Array.isArray(carousel_image_urls) ? carousel_image_urls : [];
    const carouselUrlsJson = JSON.stringify(
      rawCarousel.filter((u: string) => typeof u === 'string' && u.trim().length > 0).map((u: string) => u.trim())
    );
    const carouselAdvance =
      typeof carousel_advance_ms === 'number' && carousel_advance_ms >= 2000
        ? Math.min(carousel_advance_ms, 120000)
        : 6000;

    const promotion = await queryOne(
      `INSERT INTO platform_promotions (
        title, description, message_type, image_url,
        button_text, button_url, button_action,
        display_position, priority, is_active,
        target_audience, target_plan_ids, exclude_business_ids,
        start_date, end_date, background_color, text_color,
        dismissible, show_once_per_business, created_by,
        topbar_mode, topbar_image_urls, topbar_carousel_interval_ms,
        carousel_image_urls, carousel_advance_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb, $23, $24::jsonb, $25)
      RETURNING *`,
      [
        title, description || null, message_type, image_url || null,
        button_text || null, button_url || null, button_action || 'link',
        display_position || 0, priority || 0, is_active !== false,
        target_audience || 'all', target_plan_ids || [], exclude_business_ids || [],
        start_date || new Date(), end_date || null, 
        background_color || '#3b82f6', text_color || '#ffffff',
        dismissible !== false, show_once_per_business === true, admin.id,
        topbarMode, topbarUrlsJson, topbarInterval,
        carouselUrlsJson, carouselAdvance,
      ]
    );

    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating promotion:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create promotion' },
      { status: 500 }
    );
  }
}

