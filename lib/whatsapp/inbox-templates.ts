import { queryOne, queryRows } from '@/lib/db';
import {
  buildTemplateSendComponents,
  sendTemplateMessage,
  uploadMedia,
  type MediaRef,
} from '@/lib/meta-whatsapp';
import { storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import { mediaKindForMime, saveInboxMedia, type InboxMediaKind } from './inbox-media';
import type { InboxFile } from './inbox-send';
import type { BusinessWaTemplate } from './tenant-templates';

export class InboxTemplateError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 400) {
    super(message);
  }
}

export type InboxTemplate = Pick<
  BusinessWaTemplate,
  'id' | 'name' | 'language' | 'category' | 'header_format' | 'header_text' | 'body_text' | 'footer_text' | 'example_vars' | 'placeholder_count'
>;

/** Approved templates an agent can send from a chat (authentication codes are system-only). */
export async function listSendableTemplates(businessId: string): Promise<InboxTemplate[]> {
  return queryRows<InboxTemplate>(
    `SELECT id, name, language, category, header_format, header_text, body_text, footer_text,
            example_vars, placeholder_count
       FROM business_whatsapp_templates
      WHERE business_id = $1 AND status = 'approved' AND category <> 'AUTHENTICATION'
      ORDER BY category DESC, name, language`,
    [businessId],
  );
}

export function fillTemplateText(text: string | null | undefined, values: string[]): string {
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (_, n) => values[Number(n) - 1]?.trim() || `{{${n}}}`);
}

/** What the chat shows for a sent template. */
export function templatePreview(t: InboxTemplate, values: string[]): string {
  const parts = [
    t.header_format === 'text' && t.header_text ? `*${t.header_text}*` : '',
    fillTemplateText(t.body_text, values),
    t.footer_text ? `_${t.footer_text}_` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

const HEADER_KIND: Record<string, InboxMediaKind> = { image: 'image', video: 'video', document: 'document' };

/** Conversation row for a number the business is messaging first (Cloud API sends are not echoed back). */
async function ensureConversation(businessId: string, digits: string): Promise<string> {
  const existing = await resolveWhatsAppConversationDbId(businessId, digits);
  if (existing) return existing;
  const customer = await queryOne<{ id: string; name: string | null }>(
    `SELECT id, name FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL
        AND RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = RIGHT($2, 10)
      LIMIT 1`,
    [businessId, digits],
  ).catch(() => null);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO whatsapp_conversations
       (business_id, from_number, to_number, conversation_id, last_message_at, last_message_direction,
        customer_id, status, is_group)
     VALUES ($1, $2, '', $2, CURRENT_TIMESTAMP, 'outgoing', $3, 'active', false)
     ON CONFLICT (business_id, conversation_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
    [businessId, digits, customer?.id ?? null],
  );
  if (!row) throw new InboxTemplateError('Could not open a chat with that number', 502);
  return row.id;
}

/**
 * Sends an approved template from the business's Cloud API number and records it in the chat.
 * Works outside the 24-hour window; that is what templates are for.
 */
export async function sendInboxTemplate(input: {
  businessId: string;
  userId: string;
  to: string;
  templateId: string;
  values: string[];
  headerFile?: InboxFile;
  /** Existing chat; created from the number when omitted. */
  conversationId?: string;
}): Promise<{ conversationId: string; messageId: string }> {
  const template = await queryOne<InboxTemplate & { status: string }>(
    `SELECT id, name, language, category, header_format, header_text, body_text, footer_text,
            example_vars, placeholder_count, status
       FROM business_whatsapp_templates WHERE business_id = $1 AND id = $2`,
    [input.businessId, input.templateId],
  );
  if (!template || template.status !== 'approved' || template.category === 'AUTHENTICATION') {
    throw new InboxTemplateError('Choose an approved template', 404);
  }
  const digits = input.to.replace(/\D/g, '');
  if (digits.length < 10) throw new InboxTemplateError('That phone number is not a valid WhatsApp number');

  const values = Array.from({ length: template.placeholder_count }, (_, i) => String(input.values[i] ?? '').trim());
  const missing = values.findIndex((v) => !v);
  if (missing >= 0) throw new InboxTemplateError(`Fill in variable {{${missing + 1}}}`);

  const headerKind = HEADER_KIND[template.header_format];
  let headerMedia: MediaRef | undefined;
  let doc: { mediaId: string; filename: string } | undefined;
  if (headerKind) {
    if (!input.headerFile) throw new InboxTemplateError(`This template needs a ${headerKind} in its header`);
    if (mediaKindForMime(input.headerFile.mimeType) !== headerKind) {
      throw new InboxTemplateError(`The header must be a ${headerKind}`);
    }
    const mediaId = await uploadMedia({
      businessId: input.businessId,
      buffer: input.headerFile.buffer,
      mimeType: input.headerFile.mimeType,
      filename: input.headerFile.fileName,
      timeoutMs: 120_000,
    });
    if (headerKind === 'document') doc = { mediaId, filename: input.headerFile.fileName };
    else headerMedia = { id: mediaId };
  }

  const { messageId } = await sendTemplateMessage({
    businessId: input.businessId,
    to: digits,
    name: template.name,
    language: template.language,
    components: buildTemplateSendComponents(template, values, doc, headerMedia),
  });

  const conversationId = input.conversationId ?? (await ensureConversation(input.businessId, digits));
  const mediaUrl = input.headerFile
    ? await saveInboxMedia(input.businessId, input.headerFile.buffer, input.headerFile.mimeType)
    : undefined;
  await storeOutgoingMessage(
    input.businessId,
    conversationId,
    digits,
    templatePreview(template, values),
    messageId,
    headerKind ?? 'template',
    mediaUrl,
    undefined,
    Math.floor(Date.now() / 1000),
    null,
    { sentBy: 'staff', sentByUserId: input.userId },
  );
  return { conversationId, messageId };
}
