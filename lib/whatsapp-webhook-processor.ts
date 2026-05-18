import { processIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { sendWhatsAppMessage, extractMessageContent, crmFieldsFromExtracted, type ExtractedMessage } from '@/lib/whatsapp';
import { queryOne } from '@/lib/db';

/**
 * Same behavior as `app/api/whatsapp/webhook/route.ts` POST (CRM + send + store outgoing).
 * Used by queue worker; HTTP route can delegate here.
 */
export async function processWhatsAppWebhookBody(body: Record<string, unknown>): Promise<{ response: string | null }> {
  const business_id = body.business_id as string;
  const from = body.from as string;
  const to = (body.to as string) || '';
  const message = body.message as string;
  const message_id = (body.message_id as string) || `webhook_${Date.now()}`;

  if (!business_id || !from || !message) {
    throw new Error('Missing required fields');
  }

  const result = await processIncomingMessage(business_id, from, to, message, message_id);

  if (result.response) {
    const sendReturn = await sendWhatsAppMessage(business_id, from, result.response);
    const messageIdFromSend: string | null = typeof sendReturn === 'string' ? sendReturn : null;

    const fromDigits = from.replace(/[^0-9]/g, '');
    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations 
       WHERE business_id = $1 AND conversation_id = $2`,
      [business_id, fromDigits]
    );

    if (conv?.id && result.response) {
      const messageId = messageIdFromSend || `webhook_out_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const jid = from.includes('@') ? from : `${fromDigits}@s.whatsapp.net`;
      const originalText = result.response == null || result.response === undefined ? '' : String(result.response);

      const msg: { key: { id: string; fromMe: boolean; remoteJid: string }; message?: any } | undefined =
        result.response !== undefined && result.response !== null
          ? {
              key: { id: messageId, fromMe: true, remoteJid: jid },
              message: { conversation: originalText }
            }
          : undefined;

      let extracted: ExtractedMessage | null = null;
      try {
        if (msg?.message) {
          extracted = await extractMessageContent(msg);
        }
      } catch (err) {
        console.error('[WA] webhook extract failed', err);
      }

      let messageText = '';
      let messageType = 'text';
      let mediaUrl: string | undefined;

      if (extracted && !extracted.skip) {
        const crm = crmFieldsFromExtracted(extracted);
        messageText = crm.messageText;
        messageType = crm.messageType;
        mediaUrl = crm.mediaUrl;
      } else {
        const fallback = crmFieldsFromExtracted({
          type: 'text',
          text: originalText || '',
          hasMedia: false,
          mediaUrl: undefined,
          skip: false
        });
        messageText = fallback.messageText;
        messageType = fallback.messageType;
        mediaUrl = fallback.mediaUrl;
      }

      const sourceTimestampSec = Math.floor(Date.now() / 1000);
      await storeOutgoingMessage(
        business_id,
        conv.id,
        jid,
        messageText,
        messageId,
        messageType,
        mediaUrl,
        undefined,
        sourceTimestampSec,
        null
      );
    }
  }

  return { response: result.response != null && result.response !== undefined ? String(result.response) : null };
}
