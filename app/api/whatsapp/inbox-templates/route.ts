import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { businessTransport } from '@/lib/whatsapp/business-transport';
import { parseDataUrl, safeFileName } from '@/lib/whatsapp/inbox-media';
import { InboxTemplateError, listSendableTemplates, sendInboxTemplate } from '@/lib/whatsapp/inbox-templates';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';
import { getInboxViewer, intervene, liveOwnerId, loadOwnership, OwnershipError } from '@/lib/whatsapp/inbox-ownership';

export const dynamic = 'force-dynamic';

/** Approved templates for the inbox, plus which transport the business is on. */
export const GET = withWhatsAppPremiumApi({ inboxPermission: true }, async ({ businessId }) => {
  const transport = await businessTransport(businessId);
  const templates = transport === 'cloud' ? await listSendableTemplates(businessId) : [];
  return NextResponse.json({ transport, templates });
});

/** Starts (or restarts) a chat with a number by sending an approved template; the sender owns the chat. */
export const POST = withWhatsAppPremiumApi(
  { parseJsonBody: true, inboxPermission: true },
  async ({ businessId, userId, body }) => {
    if ((await businessTransport(businessId)) !== 'cloud') {
      return NextResponse.json(
        { error: 'Templates need the WhatsApp Business API. Connect it under Settings → WhatsApp.', code: 'NOT_CLOUD' },
        { status: 409 },
      );
    }
    const b = (body ?? {}) as { to?: unknown; template_id?: unknown; values?: unknown; header_media?: unknown; file_name?: unknown };
    const to = String(b.to || '').replace(/\D/g, '');
    const viewer = await getInboxViewer({ businessId, userId });

    const existingId = to ? await resolveWhatsAppConversationDbId(businessId, to) : null;
    if (existingId) {
      const row = await loadOwnership(businessId, existingId);
      const owner = row ? liveOwnerId(row) : null;
      if (owner && owner !== userId && !viewer.isSupervisor) {
        return NextResponse.json(
          { error: `${row?.owner_name || 'Another agent'} is handling this chat`, code: 'NOT_OWNER' },
          { status: 403 },
        );
      }
    }

    const parsed = typeof b.header_media === 'string' ? parseDataUrl(b.header_media) : null;
    try {
      const sent = await sendInboxTemplate({
        businessId,
        userId,
        to,
        conversationId: existingId ?? undefined,
        templateId: String(b.template_id || ''),
        values: Array.isArray(b.values) ? b.values.map((v) => String(v ?? '')) : [],
        headerFile: parsed
          ? { ...parsed, fileName: safeFileName(typeof b.file_name === 'string' ? b.file_name : null, parsed.mimeType) }
          : undefined,
      });
      await intervene(viewer, sent.conversationId).catch((err) => {
        if (!(err instanceof OwnershipError)) throw err;
      });
      return NextResponse.json({ success: true, conversation_id: sent.conversationId, message_id: sent.messageId }, { status: 201 });
    } catch (err) {
      if (err instanceof InboxTemplateError) return NextResponse.json({ error: err.message }, { status: err.status });
      console.error('[inbox template] start failed:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Template was not sent' }, { status: 502 });
    }
  },
);
