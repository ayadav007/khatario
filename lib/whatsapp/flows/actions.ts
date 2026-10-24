import type { FlowNode } from './schema';
import { assignToAgent, markRequesting } from '@/lib/whatsapp/inbox-ownership';
import { pauseConversationBot } from '@/lib/ai-agent/conversation';
import { query } from '@/lib/db';

export async function runFlowActions(
  businessId: string,
  conversationId: string,
  actions: Extract<FlowNode, { type: 'action' }>[],
): Promise<{ openShop: boolean }> {
  let openShop = false;
  for (const node of actions) {
    const kind = node.data.kind;
    if (kind === 'add_labels' && node.data.labelIds?.length) {
      for (const labelId of node.data.labelIds) {
        await query(
          `INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id)
           VALUES ($1, $2) ON CONFLICT (conversation_id, label_id) DO NOTHING`,
          [conversationId, labelId],
        ).catch(() => undefined);
      }
    }
    if (kind === 'remove_labels' && node.data.labelIds?.length) {
      await query(
        `DELETE FROM whatsapp_conversation_label_assignments
          WHERE conversation_id = $1 AND label_id = ANY($2::uuid[])`,
        [conversationId, node.data.labelIds],
      ).catch(() => undefined);
    }
    if (kind === 'assign_to_user_id' && node.data.userId) {
      await assignToAgent(businessId, conversationId, node.data.userId).catch(() => undefined);
    }
    if (kind === 'handoff') {
      await pauseConversationBot(businessId, conversationId, 60, 'handoff').catch(() => undefined);
      await markRequesting(businessId, conversationId).catch(() => undefined);
      if (node.data.userId) {
        await assignToAgent(businessId, conversationId, node.data.userId).catch(() => undefined);
      }
    }
    if (kind === 'open_shop') openShop = true;
  }
  return { openShop };
}
