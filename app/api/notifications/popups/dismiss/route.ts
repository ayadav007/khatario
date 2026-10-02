import { NextRequest, NextResponse } from 'next/server';
import { isUuid, requireNotificationSession } from '@/lib/notifications/notification-session';
import { dismissNotificationPopups, MAX_POPUP_DISMISS_ITEMS } from '@/lib/notifications/popup-state';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/popups/dismiss  { items: [{ id, seq }] }
 * Persists reminder popup dismissal (popup_dismissed_at) for the signed-in user's own
 * notifications in the session business. Identity comes from the session only.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireNotificationSession(request);
    if (!session.ok) return session.response;

    const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
    const raw = Array.isArray(body?.items) ? body!.items : null;
    if (!raw || raw.length === 0 || raw.length > MAX_POPUP_DISMISS_ITEMS) {
      return NextResponse.json(
        { error: `items must contain 1-${MAX_POPUP_DISMISS_ITEMS} entries` },
        { status: 400 }
      );
    }
    const items: { id: string; seq: string }[] = [];
    for (const entry of raw) {
      const e = entry as { id?: unknown; seq?: unknown };
      const seq = typeof e.seq === 'number' ? String(e.seq) : e.seq;
      if (!isUuid(e.id as string) || typeof seq !== 'string' || !/^\d{1,18}$/.test(seq)) {
        return NextResponse.json({ error: 'Invalid item' }, { status: 400 });
      }
      items.push({ id: e.id as string, seq });
    }

    const dismissed = await dismissNotificationPopups(session.businessId, session.userId, items);
    return NextResponse.json({ success: true, dismissed });
  } catch (error) {
    console.error('[Popup dismiss] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
