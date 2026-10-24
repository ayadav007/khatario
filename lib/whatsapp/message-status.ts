import { query } from '@/lib/db';

export type OutgoingStatus = 'sent' | 'delivered' | 'read' | 'failed';

const RANK_SQL = (col: string) =>
  `CASE ${col} WHEN 'pending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END`;

/**
 * Applies a delivery receipt to a message this business sent. Ticks only move forward
 * (receipts can arrive out of order); "failed" always wins. Emits a status-only live event
 * so the chat list does not treat the receipt as new activity.
 */
export async function applyOutgoingStatus(
  businessId: string,
  messageId: string,
  status: OutgoingStatus,
  errorTitle?: string | null,
): Promise<boolean> {
  const result = await query(
    `UPDATE whatsapp_conversation_messages
        SET status = $1
      WHERE message_id = $2 AND business_id = $3
        AND status IS DISTINCT FROM $1
        AND ($1 = 'failed' OR ${RANK_SQL('$1')} > ${RANK_SQL('status')})
      RETURNING conversation_id, id, message_text, message_type, media_url, direction, buttons, created_at`,
    [status, messageId, businessId],
  );
  await query(
    `UPDATE whatsapp_messages SET status = $1 WHERE business_id = $2 AND baileys_message_id = $3`,
    [status, businessId, messageId],
  ).catch(() => undefined);

  const row = result.rows[0] as { conversation_id?: string } | undefined;
  if (!row?.conversation_id) return false;
  try {
    const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
    emitNewMessage(businessId, row.conversation_id, {
      ...row,
      status,
      message_id: messageId,
      status_only: true,
      ...(errorTitle ? { error_title: errorTitle } : {}),
    });
  } catch {
    /* the next thread load shows the status */
  }
  return true;
}
