import { queryOne } from '@/lib/db';
import { businessTransport, type BusinessTransport } from './business-transport';
import { mediaKindForMime, INBOX_MEDIA_MAX, type InboxMediaKind } from './inbox-media';

/** Meta's customer-service window: free-form messages only within 24h of the customer's last message. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type InboxFile = { buffer: Buffer; mimeType: string; fileName: string };

export type InboxButton = { id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string };

export class InboxSendError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 413 | 502, readonly code: string) {
    super(message);
  }
}

export interface ReplyWindow {
  transport: BusinessTransport;
  last_incoming_at: string | null;
  /** When free-form replies stop working; null on QR numbers (no window there). */
  expires_at: string | null;
  open: boolean;
}

export async function lastIncomingAt(businessId: string, conversationId: string): Promise<Date | null> {
  const row = await queryOne<{ at: string | Date | null }>(
    `SELECT MAX(created_at) AS at FROM whatsapp_conversation_messages
      WHERE business_id = $1 AND conversation_id = $2 AND direction = 'incoming'`,
    [businessId, conversationId],
  );
  return row?.at ? new Date(row.at) : null;
}

/** Whether a free-form reply can go out now. Groups and QR numbers have no window. */
export async function replyWindow(
  businessId: string,
  conversationId: string,
  isGroup: boolean,
  now = Date.now(),
): Promise<ReplyWindow> {
  const transport: BusinessTransport = isGroup ? 'baileys' : await businessTransport(businessId);
  const last = await lastIncomingAt(businessId, conversationId);
  if (transport !== 'cloud') {
    return { transport, last_incoming_at: last?.toISOString() ?? null, expires_at: null, open: true };
  }
  const expires = last ? new Date(last.getTime() + SERVICE_WINDOW_MS) : null;
  return {
    transport,
    last_incoming_at: last?.toISOString() ?? null,
    expires_at: expires?.toISOString() ?? null,
    open: !!expires && expires.getTime() > now,
  };
}

function cloudTextWithButtons(text: string, buttons?: InboxButton[]): string {
  const options = (buttons ?? []).filter((b) => b.title?.trim());
  if (!options.length) return text;
  return [
    text.trim(),
    '',
    ...options.map((b, i) => {
      const extra = b.type === 'url' && b.url ? ` ${b.url}` : b.type === 'call' && b.phone ? ` ${b.phone}` : '';
      return `${i + 1}. ${b.title.trim()}${extra}`;
    }),
  ].join('\n');
}

/**
 * Sends a staff reply from the inbox through the business's live transport: Cloud API when
 * configured (groups always use the QR session), otherwise the QR (Baileys) session.
 */
export async function sendInboxMessage(input: {
  businessId: string;
  /** Digits for a person, or the group JID. */
  to: string;
  isGroup: boolean;
  text: string;
  file?: InboxFile;
  buttons?: InboxButton[];
  footer?: string;
}): Promise<{ transport: BusinessTransport; messageId: string; messageType: string }> {
  const kind: InboxMediaKind | null = input.file ? mediaKindForMime(input.file.mimeType) : null;
  if (input.file && kind && input.file.buffer.length > INBOX_MEDIA_MAX[kind]) {
    throw new InboxSendError(
      `This ${kind} is ${(input.file.buffer.length / 1024 / 1024).toFixed(1)} MB; WhatsApp allows up to ${INBOX_MEDIA_MAX[kind] / 1024 / 1024} MB`,
      413,
      'FILE_TOO_LARGE',
    );
  }
  const messageType = kind ?? (input.buttons?.length ? 'button' : 'text');
  const transport: BusinessTransport = input.isGroup ? 'baileys' : await businessTransport(input.businessId);

  if (transport === 'cloud') {
    const meta = await import('@/lib/meta-whatsapp');
    const to = input.to.replace(/\D/g, '');
    let messageId: string;
    if (input.file && kind) {
      const mediaId = await meta.uploadMedia({
        businessId: input.businessId,
        buffer: input.file.buffer,
        mimeType: input.file.mimeType,
        filename: input.file.fileName,
        timeoutMs: kind === 'video' || kind === 'document' ? 120_000 : 30_000,
      });
      const caption = input.text.trim() || undefined;
      if (kind === 'image') {
        ({ messageId } = await meta.sendImageMessage({ businessId: input.businessId, to, media: { id: mediaId }, caption }));
      } else if (kind === 'video') {
        ({ messageId } = await meta.sendVideoMessage({ businessId: input.businessId, to, media: { id: mediaId }, caption }));
      } else if (kind === 'audio') {
        ({ messageId } = await meta.sendAudioMessage({ businessId: input.businessId, to, media: { id: mediaId } }));
      } else {
        ({ messageId } = await meta.sendDocumentMessage({
          businessId: input.businessId,
          to,
          media: { id: mediaId },
          filename: input.file.fileName,
          caption,
        }));
      }
    } else {
      ({ messageId } = await meta.sendTextMessage({
        businessId: input.businessId,
        to,
        body: cloudTextWithButtons(input.text, input.buttons),
        previewUrl: /https?:\/\//i.test(input.text),
      }));
    }
    return { transport, messageId, messageType: messageType === 'button' ? 'text' : messageType };
  }

  const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
  const jid = input.isGroup
    ? input.to.endsWith('@g.us') ? input.to : `${input.to}@g.us`
    : input.to.includes('@') ? input.to : `${input.to.replace(/\D/g, '')}@s.whatsapp.net`;
  const result: unknown = await sendWhatsAppMessage(
    input.businessId,
    jid,
    input.text,
    input.file?.buffer,
    messageType as 'text' | 'image' | 'button' | 'document' | 'video' | 'audio',
    input.buttons,
    input.footer,
    input.file ? { mimeType: input.file.mimeType, fileName: input.file.fileName } : undefined,
  );
  if (typeof result !== 'string') {
    throw new InboxSendError('WhatsApp accepted the message but returned no message id', 502, 'NO_MESSAGE_ID');
  }
  return { transport, messageId: result, messageType };
}
