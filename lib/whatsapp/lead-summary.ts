/**
 * The lead summary on each 1:1 chat: what the customer wants, what the business (bot or staff) told
 * them, and the next step, kept in whatsapp_lead_profiles with the AI lead score.
 *
 * Every message in or out pushes summary_due_at to a few minutes ahead (scheduleLeadSummary), and the
 * whatsapp-followups cron rewrites the chats whose time has come (runDueLeadSummaries). So a burst of
 * messages costs one AI call once the chat goes quiet, and staff replies are in the summary too.
 * Gated by the business's lead_analyzer_enabled AI setting.
 */
import { query, queryOne, queryRows } from '@/lib/db';
import { LeadAnalyzer } from '@/lib/services/lead-analyzer';

/** Minutes of quiet after the latest message before the summary is rewritten. */
export const SUMMARY_QUIET_MINUTES = 10;
const MESSAGE_LIMIT = 100;

/** A new message on the chat: rewrite its summary once the chat has been quiet for a while. Never throws. */
export async function scheduleLeadSummary(businessId: string, conversationId: string): Promise<void> {
  try {
    await query(
      `UPDATE whatsapp_conversations SET summary_due_at = NOW() + make_interval(mins => $3)
        WHERE id = $1::uuid AND business_id = $2 AND NOT COALESCE(is_group, false)`,
      [conversationId, businessId, SUMMARY_QUIET_MINUTES],
    );
  } catch (err) {
    console.warn('[lead-summary] schedule failed:', err instanceof Error ? err.message : err);
  }
}

interface TranscriptRow {
  direction: string;
  message_text: string | null;
  message_type: string | null;
  sent_by: string | null;
  staff_name: string | null;
  created_at: string;
}

/** Who said it, as the summary prompt should read it. */
export function speakerFor(row: Pick<TranscriptRow, 'direction' | 'sent_by' | 'staff_name'>): string {
  if (row.direction !== 'outgoing') return 'Customer';
  if (row.sent_by === 'bot') return 'Bot';
  if (row.sent_by === 'staff') return row.staff_name?.trim() ? `${row.staff_name.trim()} (staff)` : 'Staff';
  if (row.sent_by === 'system') return 'Automated message';
  return 'Business';
}

export type LeadSummaryOutcome = 'written' | 'disabled' | 'no_customer_message' | 'no_analysis' | 'not_found';

/** Rewrites the chat's lead profile (summary, score, tags) from its latest messages. */
export async function refreshLeadProfile(businessId: string, conversationId: string): Promise<LeadSummaryOutcome> {
  const chat = await queryOne<{ is_group: boolean | null; from_number: string; customer_id: string | null }>(
    `SELECT is_group, from_number, customer_id::text AS customer_id FROM whatsapp_conversations
      WHERE id = $1::uuid AND business_id = $2`,
    [conversationId, businessId],
  );
  if (!chat || chat.is_group) return 'not_found';

  const config = await queryOne<{ lead_analyzer_enabled: boolean }>(
    `SELECT lead_analyzer_enabled FROM ai_provider_config WHERE business_id = $1`,
    [businessId],
  );
  if (!config?.lead_analyzer_enabled) return 'disabled';

  const rows = await queryRows<TranscriptRow>(
    `SELECT m.direction, m.message_text, m.message_type, m.sent_by, u.name AS staff_name, m.created_at
       FROM whatsapp_conversation_messages m
       LEFT JOIN users u ON u.id = m.sent_by_user_id AND u.business_id = m.business_id
      WHERE m.business_id = $1 AND m.conversation_id = $2::uuid
      ORDER BY m.created_at DESC, m.message_id DESC
      LIMIT ${MESSAGE_LIMIT}`,
    [businessId, conversationId],
  );
  const transcript = rows.reverse().map((r) => ({
    role: (r.direction === 'outgoing' ? 'assistant' : 'user') as 'user' | 'assistant',
    speaker: speakerFor(r),
    content: r.message_text?.trim() || `[${r.message_type || 'message'}]`,
    timestamp: r.created_at,
  }));
  if (!rows.some((r) => r.direction !== 'outgoing' && r.message_text?.trim())) return 'no_customer_message';

  const company = await queryOne<{ name: string; industry?: string }>(`SELECT name, industry FROM businesses WHERE id = $1`, [businessId]);
  const analysis = await new LeadAnalyzer().analyzeLead(businessId, { messages: transcript, companyInfo: company || undefined });
  if (!analysis) return 'no_analysis';

  const stats = await queryOne<{ total: number; incoming: number; outgoing: number }>(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE direction = 'incoming')::int AS incoming,
            COUNT(*) FILTER (WHERE direction = 'outgoing')::int AS outgoing
       FROM whatsapp_conversation_messages WHERE business_id = $1 AND conversation_id = $2::uuid`,
    [businessId, conversationId],
  );
  const responseRate = stats && stats.incoming > 0 ? (stats.outgoing / stats.incoming) * 100 : 0;

  await query(
    `INSERT INTO whatsapp_lead_profiles (
       business_id, conversation_id, customer_id, phone, lead_score, lead_status, interest_level, behavior_tags,
       sentiment, key_topics, purchase_intent, urgency_level, ai_summary, ai_insights, total_messages, response_rate,
       last_analyzed_at)
     VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $14::jsonb, $15, $16, NOW())
     ON CONFLICT (business_id, conversation_id) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, whatsapp_lead_profiles.customer_id),
       lead_score = EXCLUDED.lead_score, lead_status = EXCLUDED.lead_status, interest_level = EXCLUDED.interest_level,
       behavior_tags = EXCLUDED.behavior_tags, sentiment = EXCLUDED.sentiment, key_topics = EXCLUDED.key_topics,
       purchase_intent = EXCLUDED.purchase_intent, urgency_level = EXCLUDED.urgency_level,
       ai_summary = EXCLUDED.ai_summary, ai_insights = EXCLUDED.ai_insights, total_messages = EXCLUDED.total_messages,
       response_rate = EXCLUDED.response_rate, last_analyzed_at = NOW()`,
    [
      businessId,
      conversationId,
      chat.customer_id,
      chat.from_number,
      analysis.leadScore,
      analysis.leadStatus,
      analysis.interestLevel,
      JSON.stringify(analysis.behaviorTags),
      analysis.sentiment,
      JSON.stringify(analysis.keyTopics),
      analysis.purchaseIntent,
      analysis.urgencyLevel,
      analysis.aiSummary,
      JSON.stringify(analysis.insights),
      stats?.total ?? rows.length,
      responseRate.toFixed(2),
    ],
  );
  return 'written';
}

/**
 * Cron: claims chats whose summary is due and rewrites them. Claiming clears summary_due_at first, so
 * overlapping runs never summarise a chat twice; a message that lands meanwhile schedules it again.
 */
export async function runDueLeadSummaries(limit = 25): Promise<{ claimed: number; written: number; failed: number }> {
  const due = await queryRows<{ id: string; business_id: string }>(
    `UPDATE whatsapp_conversations c SET summary_due_at = NULL
      WHERE c.id IN (
        SELECT id FROM whatsapp_conversations
         WHERE summary_due_at <= NOW()
         ORDER BY summary_due_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
      )
      RETURNING c.id::text AS id, c.business_id::text AS business_id`,
    [Math.min(Math.max(Math.floor(limit), 1), 200)],
  );
  let written = 0;
  let failed = 0;
  for (const chat of due) {
    try {
      if ((await refreshLeadProfile(chat.business_id, chat.id)) === 'written') written++;
    } catch (err) {
      failed++;
      console.warn('[lead-summary] refresh failed:', chat.id, err instanceof Error ? err.message : err);
    }
  }
  return { claimed: due.length, written, failed };
}
