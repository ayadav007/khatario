export type RoutingHandler =
  | 'human'
  | 'payment'
  | 'shop'
  | 'flow_session'
  | 'flow_hard'
  | 'bot_rule'
  | 'router'
  | 'ai_agent'
  | 'fallback';

export async function logRouting(input: {
  businessId: string;
  conversationId?: string | null;
  messageId?: string | null;
  handler: RoutingHandler;
  flowId?: string | null;
  reason?: string | null;
  confidence?: number | null;
}): Promise<void> {
  try {
    const { query } = await import('@/lib/db');
    await query(
      `INSERT INTO whatsapp_inbound_routing_events
         (business_id, conversation_id, message_id, handler, flow_id, reason, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.businessId,
        input.conversationId ?? null,
        input.messageId ?? null,
        input.handler,
        input.flowId ?? null,
        input.reason ?? null,
        input.confidence ?? null,
      ],
    );
  } catch (err) {
    console.warn('[flows] routing log failed:', err instanceof Error ? err.message : err);
  }
}
