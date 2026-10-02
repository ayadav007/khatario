import { query, queryOne } from '@/lib/db';
import type { AgentSettings } from './types';

export type BotPauseReason = 'staff_reply' | 'handoff' | 'manual';

export async function pauseConversationBot(
  businessId: string,
  conversationId: string,
  minutes: number,
  reason: BotPauseReason,
): Promise<void> {
  await query(
    `UPDATE whatsapp_conversations
        SET bot_paused_until = NOW() + make_interval(mins => $3::int),
            bot_paused_reason = $4
      WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId, Math.max(1, Math.round(minutes)), reason],
  ).catch((err) => console.warn('[ai-agent] pause failed:', err instanceof Error ? err.message : err));
}

export async function resumeConversationBot(businessId: string, conversationId: string): Promise<void> {
  await query(
    `UPDATE whatsapp_conversations
        SET bot_paused_until = NULL, bot_paused_reason = NULL, handoff_requested_at = NULL
      WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId],
  );
}

export async function isConversationBotPaused(businessId: string, conversationId: string): Promise<boolean> {
  const row = await queryOne<{ paused: boolean }>(
    `SELECT (bot_paused_until IS NOT NULL AND bot_paused_until > NOW()) AS paused
       FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId],
  ).catch(() => null);
  return !!row?.paused;
}

/** Hand the chat to a person: pause the AI, assign, mark pending and notify the team. */
export async function performHandoff(
  businessId: string,
  conversationId: string,
  settings: AgentSettings,
  opts: { assignTo?: string; customerLabel?: string } = {},
): Promise<void> {
  const assignTo = opts.assignTo ?? settings.handoff.assignTo;
  await pauseConversationBot(businessId, conversationId, settings.handoff.pauseMinutes, 'handoff');
  await query(
    `UPDATE whatsapp_conversations
        SET handoff_requested_at = NOW(),
            conversation_status = 'pending',
            assigned_to = CASE
              WHEN $3::uuid IS NOT NULL THEN $3::uuid
              ELSE assigned_to
            END
      WHERE id = $1 AND business_id = $2`,
    [conversationId, businessId, assignTo && assignTo !== 'auto' && /^[0-9a-f-]{36}$/i.test(assignTo) ? assignTo : null],
  ).catch((err) => console.warn('[ai-agent] handoff update failed:', err instanceof Error ? err.message : err));

  if (!assignTo || assignTo === 'auto') {
    const row = await queryOne<{ assigned_to: string | null }>(
      `SELECT assigned_to FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId],
    ).catch(() => null);
    if (row && !row.assigned_to) {
      const { autoAssignConversation } = await import('@/lib/whatsapp-crm');
      await autoAssignConversation(businessId, conversationId, false);
    }
  }

  await query(
    `INSERT INTO notifications (business_id, type, title, message, reference_type, reference_id, created_at)
     VALUES ($1, 'general', $2, $3, 'whatsapp_conversation', $4, CURRENT_TIMESTAMP)`,
    [
      businessId,
      'Customer wants to talk to your team',
      `${opts.customerLabel || 'A customer'} asked for a person on WhatsApp. The AI agent is paused for this chat.`,
      conversationId,
    ],
  ).catch((err) => console.warn('[ai-agent] handoff notification failed:', err instanceof Error ? err.message : err));
}

/**
 * Remember a WhatsApp message id as sent by the AI agent, so the CRM tags it "AI" and a
 * QR echo of it is not mistaken for a staff reply.
 */
export async function markBotMessage(businessId: string, messageId: string, provider = 'baileys'): Promise<void> {
  if (!messageId) return;
  await query(
    `INSERT INTO whatsapp_inbound_events (provider, business_id, message_id, direction, handled_as)
     VALUES ($1, $2, $3, 'out', 'bot_message')
     ON CONFLICT DO NOTHING`,
    [provider, businessId, messageId],
  ).catch(() => undefined);
  await query(
    `UPDATE whatsapp_conversation_messages SET sent_by = 'bot'
      WHERE business_id = $1 AND message_id = $2 AND sent_by IS NULL`,
    [businessId, messageId],
  ).catch(() => undefined);
}

export async function isBotMessage(businessId: string, messageId: string): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM whatsapp_inbound_events
      WHERE business_id = $1 AND message_id = $2 AND direction = 'out' LIMIT 1`,
    [businessId, messageId],
  ).catch(() => null);
  return !!row;
}

/** Sent through Khatario (inbox, campaigns, reminders) rather than typed on the phone. */
export async function sentViaKhatario(businessId: string, messageId: string): Promise<boolean> {
  const row = await queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM whatsapp_messages WHERE business_id = $1 AND baileys_message_id = $2 LIMIT 1`,
    [businessId, messageId],
  ).catch(() => null);
  return !!row;
}

/** A person on the team replied: pause the AI for this chat if the owner asked for that. */
export async function onStaffReply(businessId: string, conversationId: string): Promise<void> {
  const { loadAgentSettings } = await import('./settings');
  const settings = await loadAgentSettings(businessId);
  if (!settings.handoff.pauseOnStaffReply) return;
  await pauseConversationBot(businessId, conversationId, settings.handoff.pauseMinutes, 'staff_reply');
}
