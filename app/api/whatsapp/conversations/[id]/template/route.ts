import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { canReply, liveOwnerId, loadOwnership } from '@/lib/whatsapp/inbox-ownership';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { parseDataUrl, safeFileName } from '@/lib/whatsapp/inbox-media';
import { InboxTemplateError, sendInboxTemplate } from '@/lib/whatsapp/inbox-templates';
import { queryOne } from '@/lib/db';
import { onStaffReply } from '@/lib/ai-agent/conversation';

export const dynamic = 'force-dynamic';

/** Sends an approved template into an existing chat (also works after the 24-hour window closes). */
export const POST = withWhatsAppPremiumApi<{ id: string }>(
  { parseJsonBody: true, inboxPermission: true },
  async ({ params, businessId, userId, body }) => {
    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    const row = await loadOwnership(businessId, found.id);
    if (!row || row.is_group) return NextResponse.json({ error: 'Templates can only go to a single contact' }, { status: 400 });
    if (!canReply(found.viewer, row)) {
      const owner = liveOwnerId(row);
      return NextResponse.json(
        {
          error: owner ? `${row.owner_name || 'Another agent'} is handling this chat` : 'Click Intervene to reply to this chat',
          code: owner ? 'NOT_OWNER' : 'INTERVENE_REQUIRED',
        },
        { status: 403 },
      );
    }
    if ((await businessTransport(businessId)) !== 'cloud') {
      return NextResponse.json(
        { error: 'Templates need the WhatsApp Business API. Connect it under Settings → WhatsApp.', code: 'NOT_CLOUD' },
        { status: 409 },
      );
    }
    const conv = await queryOne<{ conversation_id: string; from_number: string; is_blocked: boolean | null }>(
      `SELECT conversation_id, from_number, is_blocked FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [found.id, businessId],
    );
    if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (conv.is_blocked) {
      return NextResponse.json({ error: 'This contact is blocked. Unblock them to send messages.', code: 'BLOCKED' }, { status: 409 });
    }

    const b = (body ?? {}) as { template_id?: unknown; values?: unknown; header_media?: unknown; file_name?: unknown };
    const parsed = typeof b.header_media === 'string' ? parseDataUrl(b.header_media) : null;
    try {
      const sent = await sendInboxTemplate({
        businessId,
        userId,
        to: conv.conversation_id || conv.from_number,
        conversationId: found.id,
        templateId: String(b.template_id || ''),
        values: Array.isArray(b.values) ? b.values.map((v) => String(v ?? '')) : [],
        headerFile: parsed
          ? { ...parsed, fileName: safeFileName(typeof b.file_name === 'string' ? b.file_name : null, parsed.mimeType) }
          : undefined,
      });
      await onStaffReply(businessId, found.id).catch(() => undefined);
      const message = await queryOne<Record<string, unknown>>(
        `SELECT m.id, m.message_id, m.message_text, m.message_type, m.media_url, m.direction, m.status, m.buttons,
                m.created_at, m.sent_by, m.sent_by_user_id, su.name AS sent_by_name
           FROM whatsapp_conversation_messages m
           LEFT JOIN users su ON su.id = m.sent_by_user_id
          WHERE m.business_id = $1 AND m.message_id = $2`,
        [businessId, sent.messageId],
      );
      return NextResponse.json({ success: true, message_id: sent.messageId, message }, { status: 201 });
    } catch (err) {
      if (err instanceof InboxTemplateError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error('[inbox template] send failed:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Template was not sent' }, { status: 502 });
    }
  },
);
