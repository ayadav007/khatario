import { processIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { queryOne } from '@/lib/db';
import { isBotMessage, markBotMessage, onStaffReply, sentViaKhatario } from '@/lib/ai-agent/conversation';
import type {
  BaileysIncomingQueueJob,
  BaileysOutgoingQueueJob,
  OutgoingAfterSendQueueJob,
  WebhookQueueJob,
  WhatsAppMessageJob
} from './whatsapp-queue-types';

/**
 * Central processor for all WhatsApp message jobs (queue worker or direct fallback).
 * CRM store functions handle DB + emitNewMessage.
 */
export async function processWhatsAppMessageJob(data: WhatsAppMessageJob): Promise<void> {
  switch (data.type) {
    case 'incoming':
      await processIncomingBaileys(data);
      return;
    case 'outgoing':
      await processOutgoingBaileys(data);
      return;
    case 'outgoing-after-send':
      await processOutgoingAfterSend(data);
      return;
    case 'webhook':
      await processWebhook(data);
      return;
    case 'owner-command': {
      const { processOwnerCommand } = await import('./whatsapp/owner-command');
      await processOwnerCommand(data);
      return;
    }
    case 'cloud-incoming': {
      const { processCloudIncoming } = await import('./whatsapp/cloud-incoming');
      await processCloudIncoming(data);
      return;
    }
    case 'platform-incoming': {
      const { processPlatformIncoming } = await import('./whatsapp/platform-incoming');
      await processPlatformIncoming(data);
      return;
    }
    default:
      console.error('[BullMQ] unknown job shape', data);
  }
}

async function processWebhook(job: WebhookQueueJob): Promise<void> {
  const { processWhatsAppWebhookBody } = await import('./whatsapp-webhook-processor');
  await processWhatsAppWebhookBody(job.body);
}

async function processIncomingBaileys(job: BaileysIncomingQueueJob): Promise<void> {
  const r = await processIncomingMessage(
    job.businessId,
    job.senderJid,
    job.businessPhone,
    job.messageText,
    job.messageId,
    job.messageType,
    job.mediaUrl,
    job.isGroup,
    job.groupName,
    job.groupJid,
    job.whatsappDisplayName,
    job.sourceTimestampSec,
    job.originalWaTimestampSec
  );

  if (job.enableBotReply && r.response && !job.isGroup) {
    const { sendWhatsAppMessage, whatsappSessions: sessions } = await import('./whatsapp');
    const fromNumber = job.fromNumber;
    try {
      const delayMs = r.delaySeconds && r.delaySeconds > 0 ? r.delaySeconds * 1000 : 0;
      if (delayMs > 0) {
        const session = sessions.get(job.businessId);
        if (session?.socket && session.status === 'connected') {
          const jid = `${fromNumber}@s.whatsapp.net`;
          try {
            await session.socket.sendPresenceUpdate('composing', jid);
          } catch {
            /* ignore */
          }
          await new Promise((res) => setTimeout(res, delayMs));
          try {
            await session.socket.sendPresenceUpdate('paused', jid);
          } catch {
            /* ignore */
          }
        } else {
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }

      const jid = `${fromNumber}@s.whatsapp.net`;
      const sent =
        r.responseType === 'button' && r.buttons && r.buttons.length > 0
          ? await sendWhatsAppMessage(job.businessId, jid, r.response, undefined, 'button', r.buttons, r.footer)
          : await sendWhatsAppMessage(job.businessId, jid, r.response);
      if (typeof sent === 'string') await markBotMessage(job.businessId, sent);
    } catch (err) {
      console.error('[BullMQ] bot reply after incoming failed', err);
    }
  }
}

async function processOutgoingBaileys(job: BaileysOutgoingQueueJob): Promise<void> {
  let conversation = await queryOne<{ id: string }>(
    `SELECT id FROM whatsapp_conversations 
     WHERE business_id = $1 
       AND (
         conversation_id = $2 
         OR (NOT is_group AND (
           conversation_id = $3
           OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $3
           OR from_number = $3
           OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $3
         ))
       )
     LIMIT 1`,
    [job.businessId, job.conversationIdStr, job.normalizedRecipient]
  );

  if (!conversation) {
    const customer = await queryOne<{ id: string }>(
      `SELECT id FROM customers WHERE business_id = $1 AND phone = $2 LIMIT 1`,
      [job.businessId, job.normalizedRecipient]
    );
    const newConv = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_conversations 
       (business_id, from_number, to_number, conversation_id, last_message_text, 
        last_message_at, last_message_direction, customer_id, status, is_group, group_name, group_jid)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, 'outgoing', $6, 'active', $7, $8, $9)
       RETURNING id`,
      [
        job.businessId,
        job.normalizedRecipient,
        job.businessPhone,
        job.conversationIdStr,
        job.messageText,
        customer?.id || null,
        job.isGroup,
        job.groupName || null,
        job.groupJid || null
      ]
    );
    conversation = { id: newConv!.id };
  }

  const sentBy = job.isGroup ? null : await classifyPhoneEcho(job);

  await storeOutgoingMessage(
    job.businessId,
    conversation.id,
    job.recipientJid,
    job.messageText,
    job.messageId,
    job.messageType,
    job.mediaUrl,
    undefined,
    job.sourceTimestampSec,
    job.originalWaTimestampSec,
    { sentBy }
  );

  if (sentBy === 'staff') await onStaffReply(job.businessId, conversation.id);
}

const STAFF_ECHO_FRESH_SEC = 120;
const ECHO_RECHECK_MS = 2000;

/**
 * A fromMe message on the QR session is either our own send (bot / inbox / campaign)
 * echoed back, or someone typing on the shop's phone. Khatario logs its sends right after
 * the socket call returns, so the echo can arrive first — recheck once before calling it staff.
 * History-sync echoes (old timestamps) are left untagged.
 */
async function classifyPhoneEcho(job: BaileysOutgoingQueueJob): Promise<'bot' | 'staff' | null> {
  if (!job.messageId || job.sub !== 'upsert') return null;
  const known = async (): Promise<'bot' | 'ours' | null> => {
    if (await isBotMessage(job.businessId, job.messageId)) return 'bot';
    if (await sentViaKhatario(job.businessId, job.messageId)) return 'ours';
    return null;
  };
  let k = await known();
  if (k === 'bot') return 'bot';
  if (k === 'ours') return null;
  const ts = job.sourceTimestampSec ?? null;
  if (!ts || Date.now() / 1000 - ts > STAFF_ECHO_FRESH_SEC) return null;
  await new Promise((res) => setTimeout(res, ECHO_RECHECK_MS));
  k = await known();
  if (k === 'bot') return 'bot';
  if (k === 'ours') return null;
  return 'staff';
}

async function processOutgoingAfterSend(job: OutgoingAfterSendQueueJob): Promise<void> {
  const sentBy = (await isBotMessage(job.businessId, job.messageId)) ? 'bot' : null;
  await storeOutgoingMessage(
    job.businessId,
    job.conversationId,
    job.toJid,
    job.outText,
    job.messageId,
    job.outType,
    job.outMedia || undefined,
    undefined,
    job.outboxSourceTimestampSec,
    job.outboxOriginalWaSec,
    { sentBy }
  );
}
