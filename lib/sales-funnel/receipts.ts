import { query } from '@/lib/db';

/**
 * WhatsApp does not report video plays. Reading any funnel message sent after the demo implies
 * the demo message was read too, so the latest message id is enough to mark demo_read_at.
 */
export async function recordFunnelRead(messageId: string): Promise<void> {
  if (!messageId) return;
  await query(
    `UPDATE assistant_leads
        SET demo_read_at = CASE WHEN demo_sent_at IS NOT NULL THEN COALESCE(demo_read_at, NOW()) ELSE demo_read_at END,
            flow_data = flow_data || jsonb_build_object('last_read_at', NOW()),
            updated_at = NOW()
      WHERE last_funnel_message_id = $1`,
    [messageId],
  );
}
