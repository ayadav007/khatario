import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryRows, queryOne } from '@/lib/db';
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

    const polls = await queryRows(
      `SELECT id, question, attachment_url, audience, allow_multiple,
              expires_at::text, is_active, created_at::text
       FROM hr_engagement_polls WHERE business_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [businessId],
    );

    const enriched = [];
    for (const poll of polls) {
      const options = await queryRows(
        `SELECT id, option_text, sort_order FROM hr_engagement_poll_options
         WHERE poll_id = $1 ORDER BY sort_order`,
        [poll.id],
      );
      enriched.push({ ...poll, options });
    }

    return NextResponse.json({ polls: enriched });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load polls' }, { status: 500 });
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
    const question = String(body?.question ?? '').trim();
    const options: string[] = Array.isArray(body?.options)
      ? body.options.map((o: unknown) => String(o).trim()).filter(Boolean)
      : [];
    if (!question || options.length < 2) {
      return NextResponse.json({ error: 'Question and at least 2 options required' }, { status: 400 });
    }

    const audience = parseAudience(body?.audience);

    const poll = await queryOne<{ id: string }>(
      `INSERT INTO hr_engagement_polls (
         business_id, question, attachment_url, audience, allow_multiple, expires_at, created_by
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7) RETURNING id`,
      [
        businessId,
        question,
        body?.attachment_url ? String(body.attachment_url) : null,
        JSON.stringify(audience),
        body?.allow_multiple === true,
        body?.expires_at ? String(body.expires_at) : null,
        userId,
      ],
    );
    if (!poll) throw new Error('Failed to create poll');

    for (let i = 0; i < options.length; i++) {
      await queryOne(
        `INSERT INTO hr_engagement_poll_options (poll_id, option_text, sort_order) VALUES ($1, $2, $3)`,
        [poll.id, options[i], i],
      );
    }

    return NextResponse.json({ ok: true, id: poll.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 });
  }
}
