export const dynamic = 'force-dynamic';

/**
 * GET  /api/whatsapp/followups?when=due|upcoming|any&due_before=<ISO end of today>&conversation_id=&lead_id=&agent=&all=1
 *      Pending reminders plus { overdue, today } counts for the inbox badge.
 *      Agents get their own; supervisors may pass agent=<id> or all=1.
 * POST /api/whatsapp/followups { conversation_id | lead_id, due_at, note?, assigned_to?, cancel_on_reply? }
 *      A lead with no chat takes lead_id; a chat takes conversation_id.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { getInboxViewer } from '@/lib/whatsapp/inbox-ownership';
import { createFollowup, FollowupError, listFollowups } from '@/lib/whatsapp/followups';
import { canViewLead } from '@/lib/leads/visibility';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withWhatsAppPremiumApi({ inboxPermission: 'read' }, async ({ request, businessId, userId }) => {
  try {
    const sp = new URL(request.url).searchParams;
    const viewer = await getInboxViewer({ businessId, userId });
    let conversationId: string | null = null;
    const rawConv = sp.get('conversation_id');
    if (rawConv) {
      const found = await resolveVisibleConversation({ businessId, userId }, rawConv);
      if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      conversationId = found.id;
    }
    let leadId: string | null = null;
    const rawLead = sp.get('lead_id');
    if (rawLead) {
      if (!(await canViewLead(viewer, rawLead))) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      leadId = rawLead;
    }
    const when = sp.get('when');
    const agent = sp.get('agent');
    const result = await listFollowups(viewer, {
      when: when === 'due' || when === 'upcoming' ? when : 'any',
      dueBefore: sp.get('due_before'),
      conversationId,
      leadId,
      agentId: agent && UUID_RE.test(agent) ? agent : null,
      all: sp.get('all') === '1',
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[followups] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ businessId, userId, body }) => {
    try {
      const b = (body ?? {}) as Record<string, unknown>;
      const hasChat = typeof b.conversation_id === 'string' && b.conversation_id;
      const hasLead = typeof b.lead_id === 'string' && b.lead_id;
      if (!hasChat && !hasLead) {
        return NextResponse.json({ error: 'conversation_id or lead_id is required' }, { status: 400 });
      }
      let target: { conversationId: string } | { leadId: string };
      let viewer;
      if (hasChat) {
        const found = await resolveVisibleConversation({ businessId, userId }, b.conversation_id as string);
        if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
        target = { conversationId: found.id };
        viewer = found.viewer;
      } else {
        viewer = await getInboxViewer({ businessId, userId });
        if (!(await canViewLead(viewer, b.lead_id as string))) {
          return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
        }
        target = { leadId: b.lead_id as string };
      }
      const followup = await createFollowup(viewer, {
        ...target,
        dueAt: b.due_at,
        note: b.note,
        assignedTo: b.assigned_to,
        cancelOnReply: b.cancel_on_reply,
      });
      return NextResponse.json({ followup }, { status: 201 });
    } catch (error: any) {
      if (error instanceof FollowupError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[followups] POST error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
