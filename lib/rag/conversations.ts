import { query, queryOne, queryRows } from '@/lib/db';
import type { LlmMessage } from './llm';
import type { Audience, Channel } from './types';

export interface ConversationOwner {
  channel: Channel;
  audience: Audience;
  visitorId?: string | null;
  userId?: string | null;
  businessId?: string | null;
  phone?: string | null;
}

export interface ConversationRow {
  id: string;
  channel: Channel;
  audience: Audience;
  business_id: string | null;
  user_id: string | null;
  visitor_id: string | null;
  phone: string | null;
  lead_id: string | null;
  status: 'open' | 'handed_off' | 'closed';
}

/**
 * Conversations are only resumable by whoever started them: the same logged-in user (in-app)
 * or the same visitor cookie (public). Anything else starts a fresh conversation.
 */
export async function findOwnedConversation(id: string, owner: ConversationOwner): Promise<ConversationRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await queryOne<ConversationRow>(
    `SELECT id, channel, audience, business_id, user_id, visitor_id, phone, lead_id, status FROM kb_conversations WHERE id = $1`,
    [id],
  );
  if (!row || row.audience !== owner.audience) return null;
  if (owner.userId) {
    return row.user_id === owner.userId && row.business_id === (owner.businessId ?? null) ? row : null;
  }
  if (owner.phone) return row.channel === 'whatsapp' && row.phone === owner.phone ? row : null;
  return owner.visitorId && row.visitor_id === owner.visitorId && !row.user_id ? row : null;
}

export async function createConversation(owner: ConversationOwner, pagePath?: string | null): Promise<ConversationRow> {
  const row = await queryOne<ConversationRow>(
    `INSERT INTO kb_conversations (channel, audience, business_id, user_id, visitor_id, phone, page_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, channel, audience, business_id, user_id, visitor_id, phone, lead_id, status`,
    [
      owner.channel,
      owner.audience,
      owner.businessId ?? null,
      owner.userId ?? null,
      owner.visitorId ?? null,
      owner.phone ?? null,
      pagePath ? pagePath.slice(0, 500) : null,
    ],
  );
  if (!row) throw new Error('Could not create conversation');
  return row;
}

export async function loadHistory(conversationId: string, limit = 8): Promise<LlmMessage[]> {
  const rows = await queryRows<{ role: 'user' | 'assistant'; content: string }>(
    `SELECT role, content FROM (
       SELECT role, content, created_at FROM kb_messages
        WHERE conversation_id = $1 AND role IN ('user', 'assistant')
        ORDER BY created_at DESC LIMIT $2
     ) t ORDER BY created_at ASC`,
    [conversationId, limit],
  );
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

export interface MessageInsert {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citedChunkIds?: string[];
  retrieval?: unknown;
  intent?: string | null;
  action?: unknown;
  model?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number | null;
  answered?: boolean | null;
}

export async function insertMessage(m: MessageInsert): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO kb_messages
       (conversation_id, role, content, cited_chunk_ids, retrieval, intent, action, model, tokens_in, tokens_out, latency_ms, answered)
     VALUES ($1, $2, $3, $4::uuid[], $5::jsonb, $6, $7::jsonb, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      m.conversationId,
      m.role,
      m.content,
      m.citedChunkIds ?? [],
      m.retrieval == null ? null : JSON.stringify(m.retrieval),
      m.intent ?? null,
      m.action == null ? null : JSON.stringify(m.action),
      m.model ?? null,
      m.tokensIn ?? 0,
      m.tokensOut ?? 0,
      m.latencyMs ?? null,
      m.answered ?? null,
    ],
  );
  await query(
    `UPDATE kb_conversations SET message_count = message_count + 1, last_message_at = NOW() WHERE id = $1`,
    [m.conversationId],
  );
  return row!.id;
}

export async function markHandedOff(conversationId: string, leadId?: string | null): Promise<void> {
  await query(
    `UPDATE kb_conversations SET status = 'handed_off', lead_id = COALESCE($2, lead_id) WHERE id = $1`,
    [conversationId, leadId ?? null],
  );
}

export async function attachLead(conversationId: string, leadId: string): Promise<void> {
  await query(`UPDATE kb_conversations SET lead_id = $2 WHERE id = $1`, [conversationId, leadId]);
}
