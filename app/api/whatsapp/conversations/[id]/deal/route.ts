export const dynamic = 'force-dynamic';

/**
 * GET   /api/whatsapp/conversations/:id/deal - the deal on the chat's open lead and the business's stages
 * PATCH /api/whatsapp/conversations/:id/deal - { stage_id?, deal_value?, expected_close_on?, lost_reason? }
 *       A chat with no open lead needs a stage_id, which opens one for the chat's phone.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { ensureStages, PipelineError, type DealPatch } from '@/lib/whatsapp/pipeline';
import { loadChatDeal, setChatDeal } from '@/lib/leads/chat-deal';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: 'read' }, async ({ params, businessId, userId }) => {
  try {
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const [deal, stages] = await Promise.all([loadChatDeal(businessId, found.id), ensureStages(businessId)]);
    return NextResponse.json({ deal, stages });
  } catch (error: any) {
    console.error('[deal] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: 'update' },
  async ({ params, businessId, userId, body }) => {
    try {
      const found = await resolveVisibleConversation({ businessId, userId }, params.id);
      if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
      const b = (body ?? {}) as Record<string, any>;
      const patch: DealPatch = {};
      if ('stage_id' in b) patch.stageId = typeof b.stage_id === 'string' && b.stage_id ? b.stage_id : null;
      if ('deal_value' in b) patch.dealValue = b.deal_value === '' || b.deal_value === null ? null : Number(b.deal_value);
      if ('expected_close_on' in b) patch.expectedCloseOn = typeof b.expected_close_on === 'string' ? b.expected_close_on : null;
      if ('lost_reason' in b) patch.lostReason = typeof b.lost_reason === 'string' ? b.lost_reason : null;
      const deal = await setChatDeal(businessId, found.id, patch, { source: 'agent', userId });
      return NextResponse.json({ deal });
    } catch (error: any) {
      if (error instanceof PipelineError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      }
      console.error('[deal] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  },
);
