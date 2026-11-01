/**
 * Who sees which lead. A lead with a chat follows the chat's inbox rules (an agent sees the chats they
 * could open); a lead with no chat is visible when it is unowned or the agent's own. Supervisors see all.
 * Kept free of lib/leads/core and chat-deal so lib/whatsapp/pipeline.ts can import it without a cycle.
 */
import { queryOne } from '@/lib/db';
import { visibilityClause, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WHERE fragment limiting `leadAlias` (leads) to leads the viewer may see. The caller `LEFT JOIN`s the
 * lead's chat as `chatAlias`. `nextParam` is the next free $ index; append the returned params in order.
 */
export function leadVisibilityClause(
  viewer: InboxViewer,
  leadAlias: string,
  chatAlias: string,
  nextParam: number,
): { sql: string; params: unknown[] } {
  if (viewer.isSupervisor) return { sql: 'TRUE', params: [] };
  const chat = visibilityClause(viewer, chatAlias, nextParam);
  const p = `$${nextParam}`;
  const sql = `(
    (${leadAlias}.conversation_id IS NOT NULL AND ${chat.sql})
    OR (${leadAlias}.conversation_id IS NULL AND (${leadAlias}.owner_id IS NULL OR ${leadAlias}.owner_id = ${p}::uuid))
  )`;
  return { sql, params: chat.params };
}

/** True when the lead is in the viewer's business and the viewer may see it. */
export async function canViewLead(viewer: InboxViewer, leadId: string): Promise<boolean> {
  if (!UUID_RE.test(leadId)) return false;
  const vis = leadVisibilityClause(viewer, 'l', 'c', 3);
  const row = await queryOne<{ id: string }>(
    `SELECT l.id::text AS id
       FROM leads l
       LEFT JOIN whatsapp_conversations c ON c.id = l.conversation_id AND c.business_id = l.business_id
      WHERE l.id = $1::uuid AND l.business_id = $2 AND ${vis.sql}`,
    [leadId, viewer.businessId, ...vis.params],
  );
  return !!row;
}
