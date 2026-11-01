export const dynamic = 'force-dynamic';

/**
 * PATCH /api/whatsapp/followups/:id { status?: 'done'|'cancelled'|'pending', due_at?, note? }
 *       A new due_at snoozes the reminder (pending again, notified once more).
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { FollowupError, updateFollowup } from '@/lib/whatsapp/followups';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
      const b = (body ?? {}) as Record<string, unknown>;
      const viewer = await getInboxViewer({ businessId, userId });
      const followup = await updateFollowup(viewer, params.id, { status: b.status, dueAt: b.due_at, note: b.note });
      return NextResponse.json({ followup });
    } catch (error: any) {
      if (error instanceof FollowupError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[followups] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
