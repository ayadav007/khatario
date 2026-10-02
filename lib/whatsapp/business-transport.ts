import { query } from '@/lib/db';
import { getMetaWaConfig, sendTemplateMessage, sendTextMessage, type GraphComponent } from '@/lib/meta-whatsapp';

export type BusinessTransport = 'cloud' | 'baileys';

/**
 * Prefix on every assistant reply sent through the business's own number. In QR self-chat the
 * reply comes back to us as a `fromMe` message in the same chat; the marker makes sure we never
 * treat our own reply as a new owner command.
 */
export const ASSISTANT_MARKER = '\u2063';

export function isAssistantEcho(text: string | null | undefined): boolean {
  return typeof text === 'string' && text.startsWith(ASSISTANT_MARKER);
}

/** Cloud API when the business has saved Cloud credentials, otherwise its QR (Baileys) session. */
export async function businessTransport(businessId: string): Promise<BusinessTransport> {
  return (await getMetaWaConfig(businessId)) ? 'cloud' : 'baileys';
}

async function recordOutbound(provider: BusinessTransport, businessId: string, messageId: string | null, to: string) {
  if (!messageId) return;
  await query(
    `INSERT INTO whatsapp_inbound_events (provider, business_id, message_id, sender_phone, direction, handled_as)
     VALUES ($1, $2, $3, $4, 'out', 'assistant_reply')
     ON CONFLICT DO NOTHING`,
    [provider, businessId, messageId, to],
  ).catch(() => undefined);
}

/**
 * Sends free-form text from the business's own number. On Cloud API Meta only delivers it inside
 * the 24-hour window after the recipient last wrote to the number.
 */
export async function sendBusinessText(
  businessId: string,
  to: string,
  text: string,
): Promise<{ transport: BusinessTransport; messageId: string | null }> {
  const digits = to.replace(/\D/g, '');
  const body = `${ASSISTANT_MARKER}${text}`;
  const transport = await businessTransport(businessId);
  if (transport === 'cloud') {
    const { messageId } = await sendTextMessage({ businessId, to: digits, body });
    await recordOutbound('cloud', businessId, messageId, digits);
    return { transport, messageId };
  }
  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  const result: unknown = await sendWhatsAppMessage(businessId, `${digits}@s.whatsapp.net`, body);
  const messageId = typeof result === 'string' ? result : null;
  await recordOutbound('baileys', businessId, messageId, digits);
  return { transport, messageId };
}

/** Approved template from the business's own WhatsApp Business Account (Cloud API only). */
export async function sendBusinessTemplate(
  businessId: string,
  to: string,
  template: { name: string; language: string; components?: GraphComponent[] },
): Promise<{ messageId: string }> {
  const digits = to.replace(/\D/g, '');
  const res = await sendTemplateMessage({ businessId, to: digits, ...template });
  await recordOutbound('cloud', businessId, res.messageId, digits);
  return res;
}
