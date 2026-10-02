export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import { pauseConversationBot, resumeConversationBot } from '@/lib/ai-agent/conversation';

const MAX_PAUSE_MINUTES = 7 * 24 * 60;

async function botState(businessId: string, conversationId: string) {
  return queryOne<{ bot_paused_until: string | null; bot_paused_reason: string | null; handoff_requested_at: string | null }>(
    `SELECT bot_paused_until, bot_paused_reason, handoff_requested_at
       FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId],
  );
}

/** POST /api/whatsapp/conversations/[id]/bot — `{ action: 'pause' | 'resume', minutes? }` */
export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { module: 'whatsapp', action: 'update', parseJsonBody: true },
  async ({ params, businessId, body }) => {
    try {
      const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
      if (!conversationId) {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      }
      const { action, minutes } = (body ?? {}) as { action?: string; minutes?: unknown };
      if (action === 'resume') {
        await resumeConversationBot(businessId, conversationId);
      } else if (action === 'pause') {
        const m = Number(minutes ?? 24 * 60);
        if (!Number.isFinite(m) || m < 1) {
          return NextResponse.json({ error: 'minutes must be a positive number' }, { status: 400 });
        }
        await pauseConversationBot(businessId, conversationId, Math.min(m, MAX_PAUSE_MINUTES), 'manual');
      } else {
        return NextResponse.json({ error: "action must be 'pause' or 'resume'" }, { status: 400 });
      }
      return NextResponse.json({ success: true, ...(await botState(businessId, conversationId)) });
    } catch (error) {
      console.error('[ai-agent] conversation bot toggle failed:', error);
      return NextResponse.json({ error: 'Failed to update AI for this chat' }, { status: 500 });
    }
  },
);
