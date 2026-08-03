import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });

    const rows = await queryRows(
      `SELECT id, title, body_html, author_name, allow_employee_posts,
              published_at::text, expires_at::text, is_published
       FROM hr_engagement_articles WHERE business_id = $1
       ORDER BY published_at DESC LIMIT 50`,
      [businessId],
    );
    return NextResponse.json({ articles: rows });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load articles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const title = String(body?.title ?? '').trim();
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO hr_engagement_articles (
         business_id, title, body_html, author_name, allow_employee_posts, expires_at, is_published
       ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        businessId,
        title,
        String(body?.body_html ?? ''),
        body?.author_name ? String(body.author_name) : null,
        body?.allow_employee_posts === true,
        body?.expires_at ? String(body.expires_at) : null,
        body?.is_published !== false,
      ],
    );
    return NextResponse.json({ ok: true, id: row?.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to create article' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const id = String(body?.id ?? '');
    if (!id) return NextResponse.json({ error: 'Article id required' }, { status: 400 });

    await queryOne(
      `UPDATE hr_engagement_articles SET
         title = COALESCE($3, title),
         body_html = COALESCE($4, body_html),
         is_published = COALESCE($5, is_published),
         expires_at = COALESCE($6::timestamptz, expires_at),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [
        id,
        businessId,
        body.title ? String(body.title) : null,
        body.body_html != null ? String(body.body_html) : null,
        body.is_published != null ? Boolean(body.is_published) : null,
        body.expires_at != null ? String(body.expires_at) : null,
      ],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to update article' }, { status: 500 });
  }
}
