export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/pipeline?owner=&label_id=&search=&closed_days=&stage_id=&offset=
 * The sales board: every stage with its count, total deal value and newest cards.
 * Agents only see chats they could open in the inbox. `stage_id` + `offset` loads more of one column.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { loadBoard } from '@/lib/whatsapp/pipeline';

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'read' }, async ({ request, businessId, userId }) => {
  try {
    const sp = new URL(request.url).searchParams;
    const viewer = await getInboxViewer({ businessId, userId });
    const closedDays = Number(sp.get('closed_days'));
    const columns = await loadBoard(viewer, {
      ownerId: sp.get('owner'),
      labelId: sp.get('label_id'),
      search: sp.get('search'),
      closedDays: Number.isFinite(closedDays) && closedDays > 0 ? closedDays : undefined,
      stageId: sp.get('stage_id'),
      offset: Number(sp.get('offset')) || 0,
    });
    return NextResponse.json({ columns, is_supervisor: viewer.isSupervisor });
  } catch (error: any) {
    console.error('[pipeline] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
