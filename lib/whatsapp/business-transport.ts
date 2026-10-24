import { query } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import {
  getMetaWaConfig,
  sendCtaUrlMessage,
  sendDocumentMessage,
  sendTemplateMessage,
  sendTextMessage,
  uploadMedia,
  type GraphComponent,
} from '@/lib/meta-whatsapp';

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

/**
 * Cloud API when the business has saved Cloud credentials and an active Connect plan, otherwise
 * its QR (Baileys) session. Saved credentials stay in place so renewing Connect resumes Cloud.
 */
export async function businessTransport(businessId: string): Promise<BusinessTransport> {
  if (!(await getMetaWaConfig(businessId))) return 'baileys';
  return (await hasWhatsAppBotAddon(businessId)) ? 'cloud' : 'baileys';
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

/**
 * Text with one link. Cloud API shows a tappable button for https links; QR numbers (and
 * non-https links) get the link on its own line under the text. Returns the text as stored.
 */
export async function sendBusinessLink(
  businessId: string,
  to: string,
  message: { body: string; buttonText: string; url: string },
): Promise<{ transport: BusinessTransport; messageId: string | null; text: string }> {
  const digits = to.replace(/\D/g, '');
  const inline = `${message.body}\n\n${message.url}`;
  const transport = await businessTransport(businessId);
  if (transport === 'cloud' && /^https:\/\//i.test(message.url)) {
    const { messageId } = await sendCtaUrlMessage({
      businessId,
      to: digits,
      body: `${ASSISTANT_MARKER}${message.body}`,
      buttonText: message.buttonText,
      url: message.url,
    });
    await recordOutbound('cloud', businessId, messageId, digits);
    return { transport, messageId, text: inline };
  }
  const sent = await sendBusinessText(businessId, digits, inline);
  return { ...sent, text: inline };
}

/** A PDF from the business's own number; same 24-hour window rule as free-form text on Cloud API. */
export async function sendBusinessPdf(
  businessId: string,
  to: string,
  pdf: { buffer: Buffer; filename: string; caption?: string },
): Promise<{ transport: BusinessTransport; messageId: string | null }> {
  const digits = to.replace(/\D/g, '');
  const caption = pdf.caption ? `${ASSISTANT_MARKER}${pdf.caption}` : undefined;
  const transport = await businessTransport(businessId);
  if (transport === 'cloud') {
    const mediaId = await uploadMedia({
      businessId,
      buffer: pdf.buffer,
      mimeType: 'application/pdf',
      filename: pdf.filename,
    });
    const { messageId } = await sendDocumentMessage({
      businessId,
      to: digits,
      media: { id: mediaId },
      filename: pdf.filename,
      caption,
    });
    await recordOutbound('cloud', businessId, messageId, digits);
    return { transport, messageId };
  }
  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  const result: unknown = await sendWhatsAppMessage(
    businessId,
    `${digits}@s.whatsapp.net`,
    caption ?? ASSISTANT_MARKER,
    pdf.buffer,
    'document',
  );
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
