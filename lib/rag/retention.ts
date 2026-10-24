import { queryOne } from '@/lib/db';
import { ragConfig } from './config';

/**
 * Deletes assistant conversations (and, by cascade, their messages and feedback) idle for longer
 * than ASSISTANT_RETENTION_DAYS. Leads survive: their conversation_id is set to NULL.
 */
export async function purgeOldConversations(days = ragConfig().retentionDays): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) return 0;
  const row = await queryOne<{ deleted: string }>(
    `WITH gone AS (
       DELETE FROM kb_conversations
        WHERE last_message_at < NOW() - make_interval(days => $1::int)
        RETURNING 1
     )
     SELECT COUNT(*)::bigint AS deleted FROM gone`,
    [Math.floor(days)],
  );
  return Number(row?.deleted ?? 0);
}
