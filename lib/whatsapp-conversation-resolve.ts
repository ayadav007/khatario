import { queryOne } from '@/lib/db';
import { canViewConversation, getInboxViewer, intervene, type InboxViewer } from '@/lib/whatsapp/inbox-ownership';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tryDecodeId(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Resolves a URL/route segment (internal UUID, WhatsApp JID, or phone) to
 * `whatsapp_conversations.id` for this business. Live-only chats that were
 * never written to the DB return null.
 */
export async function resolveWhatsAppConversationDbId(
  businessId: string,
  idOrJid: string
): Promise<string | null> {
  const raw = tryDecodeId(idOrJid.trim());
  if (!raw) {
    return null;
  }

  if (UUID_RE.test(raw)) {
    const row = await queryOne<{ id: string }>(
      `SELECT id::text AS id FROM whatsapp_conversations
       WHERE business_id = $1 AND id = $2::uuid
       LIMIT 1`,
      [businessId, raw]
    );
    return row?.id ?? null;
  }

  if (raw.includes('@g.us')) {
    const row = await queryOne<{ id: string }>(
      `SELECT id::text AS id FROM whatsapp_conversations
       WHERE business_id = $1 AND is_group = true AND conversation_id = $2
       LIMIT 1`,
      [businessId, raw]
    );
    return row?.id ?? null;
  }

  const digits = raw.replace(/\D/g, '');
  const atS = digits ? `${digits}@s.whatsapp.net` : '';

  const row = await queryOne<{ id: string }>(
    `SELECT id::text AS id FROM whatsapp_conversations
     WHERE business_id = $1
       AND (NOT is_group)
       AND (
         conversation_id = $2
         OR (COALESCE($3, '') <> '' AND conversation_id = $3)
         OR from_number = $2
         OR (COALESCE($3, '') <> '' AND from_number = $3)
         OR (length($4) > 0 AND REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $4)
         OR (length($4) > 0 AND REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $4)
       )
     LIMIT 1`,
    [businessId, raw, atS || null, digits]
  );
  return row?.id ?? null;
}

/**
 * Like {@link resolveWhatsAppConversationDbId}, but returns null when the signed-in user may not
 * see the chat (owned by another agent, or outside their agent label rules).
 */
export async function resolveVisibleConversation(
  ctx: { businessId: string; userId: string },
  idOrJid: string
): Promise<{ id: string; viewer: InboxViewer } | null> {
  const id = await resolveWhatsAppConversationDbId(ctx.businessId, idOrJid);
  if (!id) return null;
  const viewer = await getInboxViewer(ctx);
  if (!(await canViewConversation(viewer, id))) return null;
  return { id, viewer };
}

/**
 * A chat started from the inbox belongs to whoever started it. The conversation row only appears
 * once WhatsApp echoes the send, so poll briefly before giving up.
 */
export async function claimStartedChat(businessId: string, userId: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const conversationId = await resolveWhatsAppConversationDbId(businessId, to).catch(() => null);
    if (conversationId) {
      await intervene(await getInboxViewer({ businessId, userId }), conversationId).catch(() => undefined);
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
