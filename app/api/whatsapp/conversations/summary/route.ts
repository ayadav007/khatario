export const dynamic = 'force-dynamic';

/**
 * API endpoint for conversation summary counters
 * GET /api/whatsapp/conversations/summary
 */

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { getInboxViewer, UNOWNED_SQL, visibilityClause } from '@/lib/whatsapp/inbox-ownership';

export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ businessId, userId }) => {
  try {
    const viewer = await getInboxViewer({ businessId, userId });
    const visibility = visibilityClause(viewer, 'c', 3);
    const unowned = UNOWNED_SQL('c');
    const summary = await queryOne<{
      unread: number;
      new: number;
      open: number;
      pending: number;
      closed: number;
      bot_resolved: number;
      hot: number;
      warm: number;
      cold: number;
      not_interested: number;
      active: number;
      requesting: number;
      intervened: number;
      intervened_by_me: number;
      intervened_by_others: number;
    }>(`
      SELECT 
        COUNT(*) FILTER (WHERE unread_count > 0 AND status = 'active')::int as unread,
        COUNT(*) FILTER (WHERE last_message_direction = 'incoming' 
          AND status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM whatsapp_conversation_messages m 
            WHERE m.conversation_id = c.id AND m.direction = 'outgoing'
          ))::int as new,
        COUNT(*) FILTER (WHERE conversation_status = 'open' AND status = 'active')::int as open,
        COUNT(*) FILTER (WHERE conversation_status = 'pending' AND status = 'active')::int as pending,
        COUNT(*) FILTER (WHERE conversation_status = 'closed' AND status = 'active')::int as closed,
        COUNT(*) FILTER (WHERE conversation_status = 'bot_resolved' AND status = 'active')::int as bot_resolved,
        COUNT(*) FILTER (WHERE lp.lead_status = 'hot' AND c.status = 'active')::int as hot,
        COUNT(*) FILTER (WHERE lp.lead_status = 'warm' AND c.status = 'active')::int as warm,
        COUNT(*) FILTER (WHERE lp.lead_status = 'cold' AND c.status = 'active')::int as cold,
        COUNT(*) FILTER (WHERE lp.lead_status = 'not_interested' AND c.status = 'active')::int as not_interested,
        COUNT(*) FILTER (WHERE c.status = 'active' AND c.inbox_state = 'active' AND ${unowned})::int as active,
        COUNT(*) FILTER (WHERE c.status = 'active' AND c.inbox_state = 'requesting' AND ${unowned})::int as requesting,
        COUNT(*) FILTER (WHERE c.status = 'active' AND NOT ${unowned})::int as intervened,
        COUNT(*) FILTER (WHERE c.status = 'active' AND NOT ${unowned} AND c.assigned_to = $2::uuid)::int as intervened_by_me,
        COUNT(*) FILTER (WHERE c.status = 'active' AND NOT ${unowned} AND c.assigned_to <> $2::uuid)::int as intervened_by_others
      FROM whatsapp_conversations c
      LEFT JOIN whatsapp_lead_profiles lp ON lp.conversation_id = c.id AND lp.business_id = c.business_id
      WHERE c.business_id = $1 AND ${visibility.sql}
    `, [businessId, userId, ...visibility.params]);

    return NextResponse.json({ summary, viewer: { user_id: userId, is_supervisor: viewer.isSupervisor } });
  } catch (error: any) {
    console.error('Error fetching conversation summary:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
