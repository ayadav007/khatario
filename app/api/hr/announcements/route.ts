import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, queryRows } from '@/lib/db';
import { parseAudience } from '@/lib/hr/engagement';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'settings', 'read', { businessId });

    const includeArchived = request.nextUrl.searchParams.get('archived') === '1';

    const rows = await queryRows(
      `SELECT id, title, body, author_name, published_at::text, expires_at::text,
              audience, attachment_url, is_active, archived_at::text
       FROM hr_announcements WHERE business_id = $1
         ${includeArchived ? '' : 'AND archived_at IS NULL'}
       ORDER BY published_at DESC LIMIT 50`,
      [businessId],
    );
    return NextResponse.json({ announcements: rows });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
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

    const audience = parseAudience(body?.audience);

    const row = await queryOne<{ id: string }>(
      `INSERT INTO hr_announcements (business_id, title, body, author_name, expires_at, audience, attachment_url)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id`,
      [
        businessId,
        title,
        body?.body ? String(body.body) : null,
        body?.author_name ? String(body.author_name) : null,
        body?.expires_at ? String(body.expires_at) : null,
        JSON.stringify(audience),
        body?.attachment_url ? String(body.attachment_url) : null,
      ],
    );

    return NextResponse.json({ ok: true, id: row?.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
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
    if (!id) return NextResponse.json({ error: 'Id required' }, { status: 400 });

    if (body.archive === true) {
      await queryOne(
        `UPDATE hr_announcements SET archived_at = CURRENT_TIMESTAMP, is_active = false
         WHERE id = $1 AND business_id = $2`,
        [id, businessId],
      );
      return NextResponse.json({ ok: true });
    }

    await queryOne(
      `UPDATE hr_announcements SET
         title = COALESCE($3, title),
         body = COALESCE($4, body),
         expires_at = COALESCE($5::timestamptz, expires_at),
         is_active = COALESCE($6, is_active)
       WHERE id = $1 AND business_id = $2`,
      [
        id,
        businessId,
        body.title ? String(body.title) : null,
        body.body != null ? String(body.body) : null,
        body.expires_at != null ? String(body.expires_at) : null,
        body.is_active != null ? Boolean(body.is_active) : null,
      ],
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
}
