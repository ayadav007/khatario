import { ASSISTANT_MARKER, businessTransport, sendBusinessText } from '@/lib/whatsapp/business-transport';
import { sendImageMessage, sendInteractiveButtons, sendInteractiveList, sendVideoMessage } from '@/lib/meta-whatsapp';

/** Reply payload the inbound pipeline can send without flattening buttons. */
export type FlowReply = {
  text: string;
  header?: string;
  footer?: string;
  buttons?: Array<{ id: string; title: string }>;
  list?: { buttonText: string; rows: Array<{ id: string; title: string; description?: string }> };
  mediaType?: 'none' | 'image' | 'video';
  mediaUrl?: string;
  delaySeconds?: number;
};

export type CrmBotResult = {
  response?: string;
  shouldStore?: boolean;
  handled?: boolean;
  responseType?: string;
  buttons?: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>;
  footer?: string;
  list?: FlowReply['list'];
  delaySeconds?: number;
  enableTyping?: boolean;
};

export function replyToCrm(reply: FlowReply): CrmBotResult {
  return {
    response: reply.text,
    shouldStore: true,
    handled: true,
    footer: reply.footer,
    buttons: reply.buttons?.map((b) => ({ ...b, type: 'quick_reply' as const })),
    list: reply.list,
    responseType: reply.list ? 'list' : reply.buttons?.length ? 'button' : 'text',
    delaySeconds: reply.delaySeconds || 0,
  };
}

/** Flow claimed the turn but sent nothing — the AI agent should answer instead. */
export function isSilentHandledResult(
  result: CrmBotResult | { openShop: true } | null,
): result is CrmBotResult {
  if (!result || 'openShop' in result) return false;
  if (!result.handled) return false;
  if (result.response?.trim()) return false;
  if (result.list?.rows?.length) return false;
  if (result.buttons?.length) return false;
  return true;
}

export async function sendFlowReply(
  businessId: string,
  to: string,
  reply: FlowReply,
): Promise<{ messageId: string | null; storedText: string }> {
  const digits = to.replace(/\D/g, '');
  const transport = await businessTransport(businessId);
  const header = reply.header?.trim();
  const bodyText = header ? `*${header}*\n${reply.text}` : reply.text;
  const body = `${ASSISTANT_MARKER}${bodyText}`;

  if (transport === 'cloud' && reply.mediaUrl && (reply.mediaType === 'image' || reply.mediaType === 'video')) {
    try {
      const media = { link: reply.mediaUrl };
      const caption = (header ? `${header}\n${reply.text}` : reply.text).slice(0, 1024);
      if (reply.mediaType === 'image') {
        const { messageId } = await sendImageMessage({ businessId, to: digits, media, caption });
        return { messageId, storedText: storedInteractive(reply) };
      }
      const { messageId } = await sendVideoMessage({ businessId, to: digits, media, caption });
      return { messageId, storedText: storedInteractive(reply) };
    } catch (err) {
      console.warn('[flows] media send failed, text fallback:', err instanceof Error ? err.message : err);
    }
  }

  if (transport === 'cloud' && reply.list?.rows.length) {
    try {
      const { messageId } = await sendInteractiveList({
        businessId,
        to: digits,
        body,
        buttonText: reply.list.buttonText,
        rows: reply.list.rows,
        footer: reply.footer,
        headerText: header,
      });
      return { messageId, storedText: storedInteractive(reply) };
    } catch (err) {
      console.warn('[flows] list send failed, text fallback:', err instanceof Error ? err.message : err);
    }
  }

  if (transport === 'cloud' && reply.buttons?.length) {
    try {
      const { messageId } = await sendInteractiveButtons({
        businessId,
        to: digits,
        body,
        buttons: reply.buttons,
        footer: reply.footer,
        header: header ? { type: 'text', text: header } : undefined,
      });
      return { messageId, storedText: storedInteractive(reply) };
    } catch (err) {
      console.warn('[flows] button send failed, text fallback:', err instanceof Error ? err.message : err);
    }
  }

  if (transport === 'baileys' && (reply.buttons?.length || reply.list?.rows.length)) {
    try {
      const { sendWhatsAppMessage } = await import('@/lib/whatsapp');
      const buttons = reply.buttons?.length
        ? reply.buttons.map((b) => ({ id: b.id, title: b.title, type: 'quick_reply' as const }))
        : reply.list!.rows.map((r) => ({ id: r.id, title: r.title, type: 'quick_reply' as const }));
      const result: unknown = await sendWhatsAppMessage(
        businessId,
        `${digits}@s.whatsapp.net`,
        body,
        undefined,
        'button',
        buttons,
        reply.footer,
      );
      const messageId = typeof result === 'string' ? result : null;
      return { messageId, storedText: storedInteractive(reply) };
    } catch (err) {
      console.warn('[flows] baileys interactive send failed:', err instanceof Error ? err.message : err);
    }
  }

  const text = storedInteractive(reply);
  const sent = await sendBusinessText(businessId, digits, text);
  return { messageId: sent.messageId, storedText: text };
}

function storedInteractive(reply: FlowReply): string {
  const lines = [];
  if (reply.header?.trim()) lines.push(reply.header.trim());
  lines.push(reply.text.trim());
  const opts = reply.buttons?.length
    ? reply.buttons
    : reply.list?.rows.map((r) => ({ id: r.id, title: r.title })) ?? [];
  if (opts.length) lines.push('', ...opts.map((b, i) => `${i + 1}. ${b.title}`));
  if (reply.footer?.trim()) lines.push('', reply.footer.trim());
  return lines.join('\n');
}
