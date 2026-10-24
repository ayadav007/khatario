import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { loadReviewItems } from '@/lib/items/scan-add-review';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/items/scan-add/review  { item_ids: string[] }
 * Current details of the items a Scan & Add session touched, with what each still lacks.
 * POST because a 300-product session does not fit in a URL. Reads only.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    try {
      await authorize(session.userId, 'items', 'read', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = (await request.json().catch(() => null)) as { item_ids?: unknown } | null;
    const raw = Array.isArray(body?.item_ids) ? body!.item_ids : null;
    if (!raw) return NextResponse.json({ error: 'item_ids must be a list' }, { status: 400 });
    if (raw.length > MAX_ITEMS) return NextResponse.json({ error: `At most ${MAX_ITEMS} items at a time` }, { status: 400 });
    const ids = [...new Set(raw.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))];

    const items = await loadReviewItems(getPool(), session.businessId, ids);
    return NextResponse.json({ items });
  } catch (error) {
    console.error('[scan-add/review]', error);
    return NextResponse.json({ error: 'Could not load the review' }, { status: 500 });
  }
}
