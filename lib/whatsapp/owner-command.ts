import { query, queryOne } from '@/lib/db';
import { OWNER_HELP_TEXT } from '@/lib/insights/commands';
import { toWhatsAppText } from '@/lib/insights/format';
import { canSeeBusinessData } from '@/lib/insights/turn';
import { answerTurn } from '@/lib/rag/answer';
import type { OwnerCommandQueueJob } from '@/lib/whatsapp-queue-types';
import { sendBusinessText } from './business-transport';
import { clearOwnerLinkCache, digits, getOwnerLink, linkCodeValid, parseLinkCode } from './inbound-router';

export const OWNER_MESSAGES_PER_HOUR = 20;
const REPLY_MAX_CHARS = 3500;
const CONVERSATION_IDLE_HOURS = 6;
const HELP_ONLY = /^\s*(help|menu|options|commands|\?|hi|hello|hey|namaste|start)\s*[.!?]*\s*$/i;

const LINKED_TEXT = [
  '*Linked!* This number now gets your Khatario owner updates.',
  '',
  'Ask things like "sales today", "who owes me the most" or "low stock". Send *summary* any time for the day at a glance.',
  'Turn the evening summary on or off in Khatario: Settings > WhatsApp > Owner updates.',
].join('\n');

async function businessActive(businessId: string): Promise<boolean> {
  const { assertOperationalSubscription } = await import('@/lib/security/require-operational-subscription');
  return (await assertOperationalSubscription(businessId).catch(() => ({ ok: false }))).ok;
}

async function ownerMessagesLastHour(businessId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT COUNT(*) AS n FROM whatsapp_inbound_events
      WHERE business_id = $1 AND direction = 'in' AND handled_as = 'owner' AND created_at > NOW() - INTERVAL '1 hour'`,
    [businessId],
  ).catch(() => null);
  return Number(row?.n ?? 0);
}

async function recentConversationId(businessId: string, userId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM kb_conversations
      WHERE channel = 'whatsapp' AND audience = 'tenant_owner' AND business_id = $1 AND user_id = $2
        AND COALESCE(last_message_at, created_at) > NOW() - ($3 || ' hours')::interval
      ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 1`,
    [businessId, userId, String(CONVERSATION_IDLE_HOURS)],
  ).catch(() => null);
  return row?.id ?? null;
}

/** Runs one owner question through the assistant and returns WhatsApp-ready text. */
export async function ownerReply(input: { businessId: string; userId: string; phone: string; text: string }): Promise<string> {
  if (HELP_ONLY.test(input.text)) return OWNER_HELP_TEXT.replace(/^- /gm, '• ');
  const conversationId = await recentConversationId(input.businessId, input.userId);
  let text = '';
  let error: string | null = null;
  for await (const ev of answerTurn({
    message: input.text,
    conversationId,
    channel: 'whatsapp',
    audience: 'tenant_owner',
    userId: input.userId,
    businessId: input.businessId,
    phone: input.phone,
    textFormat: 'whatsapp',
  })) {
    if (ev.type === 'delta') text += ev.text;
    else if (ev.type === 'error') error = ev.message;
  }
  const out = toWhatsAppText(text || error || 'Sorry, I could not answer that. Please try again.');
  return out.length > REPLY_MAX_CHARS ? `${out.slice(0, REPLY_MAX_CHARS - 1).replace(/\s+\S*$/, '')}…` : out;
}

async function completeLink(job: OwnerCommandQueueJob): Promise<boolean> {
  const code = parseLinkCode(job.text);
  const link = await getOwnerLink(job.businessId, true);
  if (!code || !link || !linkCodeValid(link, code)) return false;
  const res = await query(
    `UPDATE owner_whatsapp_links
        SET linked_phone = $2, self_chat = $3, linked_at = NOW(), last_owner_message_at = NOW(),
            link_code = NULL, link_code_expires_at = NULL, updated_at = NOW()
      WHERE business_id = $1 AND link_code = $4 AND link_code_expires_at > NOW()`,
    [job.businessId, digits(job.from), job.selfChat, code],
  );
  clearOwnerLinkCache(job.businessId);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Queue job for owner messages. Never throws: a retry would send the reply twice, so failures
 * are logged and dropped.
 */
export async function processOwnerCommand(job: OwnerCommandQueueJob): Promise<void> {
  try {
    if (!(await businessActive(job.businessId))) return;

    if (job.kind === 'link') {
      if (await completeLink(job)) await sendBusinessText(job.businessId, job.from, LINKED_TEXT);
      return;
    }

    const link = await getOwnerLink(job.businessId, true);
    if (!link?.linked_phone) return;
    await query(`UPDATE owner_whatsapp_links SET last_owner_message_at = NOW() WHERE business_id = $1`, [job.businessId]);

    if (!(await canSeeBusinessData(link.user_id, job.businessId))) {
      await sendBusinessText(
        job.businessId,
        link.linked_phone,
        'Owner updates are paused: the linked Khatario user is no longer the active primary admin. Re-link from Settings > WhatsApp.',
      );
      return;
    }
    const lastHour = await ownerMessagesLastHour(job.businessId);
    if (lastHour > OWNER_MESSAGES_PER_HOUR) {
      if (lastHour === OWNER_MESSAGES_PER_HOUR + 1) {
        await sendBusinessText(job.businessId, link.linked_phone, `That's a lot of questions! Please try again in a little while.`);
      }
      return;
    }

    const reply = await ownerReply({ businessId: job.businessId, userId: link.user_id, phone: link.linked_phone, text: job.text });
    await sendBusinessText(job.businessId, link.linked_phone, reply);
  } catch (err) {
    console.error('[owner-command] failed:', err instanceof Error ? err.message : err);
  }
}
