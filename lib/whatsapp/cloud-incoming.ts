import { queryOne } from '@/lib/db';
import { processIncomingMessage, storeIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import type { CloudIncomingQueueJob } from '@/lib/whatsapp-queue-types';
import { sendBusinessText } from './business-transport';
import { queueIfUnanswered } from './inbox-ownership';

/** A cart sent from the business's Meta catalog: stored in the inbox, then ordered and billed. */
async function processCloudCart(job: CloudIncomingQueueJob & { order: NonNullable<CloudIncomingQueueJob['order']> }) {
  const units = job.order.items.reduce((n, i) => n + i.quantity, 0);
  const summary = `🛒 Sent a cart (${units} item${units === 1 ? '' : 's'})${job.order.note ? `\n${job.order.note}` : ''}`;
  const { conversationId } = await storeIncomingMessage(
    job.businessId,
    `${job.from}@s.whatsapp.net`,
    job.businessPhone,
    summary,
    job.messageId,
    'text',
    undefined,
    false,
    undefined,
    undefined,
    job.profileName ?? undefined,
    job.sourceTimestampSec,
    null,
  );
  const { placeShopOrder, sendShopOrderReply } = await import('@/lib/whatsapp-shop/order');
  const outcome = await placeShopOrder({
    businessId: job.businessId,
    phone: job.from,
    conversationUuid: conversationId ?? null,
    customerName: job.profileName,
    note: job.order.note,
    lines: job.order.items.map((i) => ({ itemId: i.retailerId, quantity: i.quantity })),
  });
  await sendShopOrderReply(job.businessId, job.from, outcome);
}

/** Saves the customer's file locally (Meta's copy needs a token and expires); undefined if it can't be fetched. */
async function storeCloudMedia(
  businessId: string,
  media: NonNullable<CloudIncomingQueueJob['media']>,
): Promise<string | undefined> {
  try {
    const { downloadMedia } = await import('@/lib/meta-whatsapp');
    const { saveInboxMedia } = await import('./inbox-media');
    const file = await downloadMedia({ businessId, mediaId: media.id });
    return await saveInboxMedia(businessId, file.buffer, media.mimeType || file.mimeType);
  } catch (err) {
    console.error('[cloud-incoming] media download failed:', err instanceof Error ? err.message : err);
    return undefined;
  }
}

type BotButton = { title: string; type?: string; phone?: string; url?: string };

/** Cloud API text replies have no QR-style buttons here: list them as lines the customer can type. */
export function cloudReplyText(response: string, buttons?: BotButton[], footer?: string): string {
  const lines = [response.trim()];
  const options = (buttons ?? []).filter((b) => b.title?.trim());
  if (options.length) {
    lines.push('', ...options.map((b, i) => {
      const extra = b.type === 'url' && b.url ? ` ${b.url}` : b.type === 'call' && b.phone ? ` ${b.phone}` : '';
      return `${i + 1}. ${b.title.trim()}${extra}`;
    }));
  }
  if (footer?.trim()) lines.push('', `_${footer.trim()}_`);
  return lines.join('\n');
}

/**
 * A customer's message on the business's Cloud API number: stored in the CRM inbox like a QR
 * message, then the shop's bot reply (if any) goes back from the same number. Never throws, so a
 * queue retry cannot store or answer it twice.
 */
export async function processCloudIncoming(job: CloudIncomingQueueJob): Promise<void> {
  try {
    if (job.order?.items.length) {
      await processCloudCart({ ...job, order: job.order });
      return;
    }
    const mediaUrl = job.media ? await storeCloudMedia(job.businessId, job.media) : undefined;
    if (job.media && !job.text.trim()) {
      // Photos, voice notes and files without a caption go to a person; the bot has nothing to read.
      const { conversationId } = await storeIncomingMessage(
        job.businessId,
        `${job.from}@s.whatsapp.net`,
        job.businessPhone,
        job.media.kind === 'document' ? job.media.filename || '' : '',
        job.messageId,
        job.media.kind,
        mediaUrl,
        false,
        undefined,
        undefined,
        job.profileName ?? undefined,
        job.sourceTimestampSec,
        null,
      );
      await queueIfUnanswered(job.businessId, conversationId ?? undefined, { replied: false, handled: false });
      return;
    }
    if (!job.text.trim() && !job.replyId) return;
    const out: { conversationUuid?: string; replyId?: string | null } = { replyId: job.replyId ?? null };
    const result = await processIncomingMessage(
      job.businessId,
      `${job.from}@s.whatsapp.net`,
      job.businessPhone,
      job.text,
      job.messageId,
      job.media ? job.media.kind : job.messageType === 'text' ? 'text' : job.messageType,
      mediaUrl,
      false,
      undefined,
      undefined,
      job.profileName ?? undefined,
      job.sourceTimestampSec,
      null,
      out,
    );
    await queueIfUnanswered(job.businessId, out.conversationUuid, {
      replied: !!result.response?.trim() || !!result.list || !!(result.buttons && result.buttons.length),
      handled: result.handled,
    });
    if (!result.response?.trim() && !result.list && !(result.buttons && result.buttons.length)) return;

    const delayMs = Math.min(Math.max(result.delaySeconds ?? 0, 0), 10) * 1000;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

    let storedText: string;
    let messageId: string | null;
    if (result.list || (result.buttons && result.buttons.length)) {
      const { sendFlowReply } = await import('@/lib/whatsapp/flows/send');
      const sent = await sendFlowReply(job.businessId, job.from, {
        text: result.response || '',
        footer: result.footer,
        buttons: result.buttons?.map((b) => ({ id: b.id, title: b.title })),
        list: result.list,
      });
      storedText = sent.storedText;
      messageId = sent.messageId;
    } else {
      const text = cloudReplyText(result.response || '', result.buttons, result.footer);
      const sent = await sendBusinessText(job.businessId, job.from, text);
      storedText = text;
      messageId = sent.messageId;
    }

    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations WHERE business_id = $1 AND conversation_id = $2 LIMIT 1`,
      [job.businessId, job.from],
    ).catch(() => null);
    if (conv?.id) {
      await storeOutgoingMessage(
        job.businessId,
        conv.id,
        `${job.from}@s.whatsapp.net`,
        storedText,
        messageId ?? `cloud_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        'text',
        undefined,
        undefined,
        Math.floor(Date.now() / 1000),
        null,
        { sentBy: 'bot' },
      );
    }
  } catch (err) {
    console.error('[cloud-incoming] failed:', err instanceof Error ? err.message : err);
  }
}
