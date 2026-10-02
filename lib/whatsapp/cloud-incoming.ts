import { queryOne } from '@/lib/db';
import { processIncomingMessage, storeOutgoingMessage } from '@/lib/whatsapp-crm';
import type { CloudIncomingQueueJob } from '@/lib/whatsapp-queue-types';
import { sendBusinessText } from './business-transport';

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
    const result = await processIncomingMessage(
      job.businessId,
      `${job.from}@s.whatsapp.net`,
      job.businessPhone,
      job.text,
      job.messageId,
      job.messageType === 'text' ? 'text' : job.messageType,
      undefined,
      false,
      undefined,
      undefined,
      job.profileName ?? undefined,
      job.sourceTimestampSec,
      null,
    );
    if (!result.response?.trim()) return;

    const delayMs = Math.min(Math.max(result.delaySeconds ?? 0, 0), 10) * 1000;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

    const text = cloudReplyText(result.response, result.buttons, result.footer);
    const sent = await sendBusinessText(job.businessId, job.from, text);

    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations WHERE business_id = $1 AND conversation_id = $2 LIMIT 1`,
      [job.businessId, job.from],
    ).catch(() => null);
    if (conv?.id) {
      await storeOutgoingMessage(
        job.businessId,
        conv.id,
        `${job.from}@s.whatsapp.net`,
        text,
        sent.messageId ?? `cloud_out_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
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
