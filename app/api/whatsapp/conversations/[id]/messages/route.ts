export const dynamic = 'force-dynamic';

/**
 * API endpoint for fetching and sending messages in a conversation
 */

import { NextResponse } from 'next/server';
import { queryRows, query, queryOne } from '@/lib/db';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { parseDataUrl, safeFileName, saveInboxMedia } from '@/lib/whatsapp/inbox-media';
import { InboxSendError, replyWindow, sendInboxMessage, type InboxFile } from '@/lib/whatsapp/inbox-send';
import { resolveVisibleConversation } from '@/lib/whatsapp-conversation-resolve';
import { onStaffReply } from '@/lib/ai-agent/conversation';
import {
  canReply,
  listOwnershipEvents,
  liveOwnerId,
  loadOwnership,
  ownershipView,
} from '@/lib/whatsapp/inbox-ownership';

export const GET = withWhatsAppPremiumApi<{ id: string }>({ inboxPermission: true }, async ({ params, request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);

    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const conversationId = found.id;
    const ownershipRow = await loadOwnership(businessId, conversationId);

    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const pageSize = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));
    const fetchCount = pageSize + 1;

    const beforeCreatedAt = searchParams.get('before_created_at');
    const beforeMessageId = searchParams.get('before_message_id');
    const loadOlder = Boolean(beforeCreatedAt && beforeMessageId);

    // First, check if this is a group conversation
    const conversation = await queryRows(
      `SELECT is_group, conversation_id, from_number FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    if (conversation.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const isGroup = conversation[0]?.is_group || false;

    const selectList = `m.id,
          m.message_id,
          m.from_number,
          m.to_number,
          m.message_text,
          m.message_type,
          m.media_url,
          m.direction,
          m.status,
          m.buttons,
          m.created_at,
          ${
            isGroup
              ? `COALESCE(m.sender_name, cust.name, NULL) as sender_name,
          m.from_number as sender_number`
              : 'NULL as sender_name, NULL as sender_number'
          }
          , m.source_timestamp, m.sent_by, m.sent_by_user_id, su.name as sent_by_name`;

    const fromJoin = `FROM whatsapp_conversation_messages m
         LEFT JOIN users su ON su.id = m.sent_by_user_id
         ${
           isGroup
             ? `LEFT JOIN customers cust ON cust.business_id = $2
           AND (
             cust.phone = m.from_number
             OR cust.phone = REGEXP_REPLACE(m.from_number, '[^0-9]', '', 'g')
             OR REGEXP_REPLACE(cust.phone, '[^0-9]', '', 'g') = REGEXP_REPLACE(m.from_number, '[^0-9]', '', 'g')
             OR m.from_number LIKE '%' || cust.phone || '%'
             OR cust.phone LIKE '%' || REGEXP_REPLACE(m.from_number, '[^0-9]', '', 'g') || '%'
           )`
             : ''
         }`;

    let messages: Array<Record<string, unknown>>;

    if (loadOlder) {
      messages = await queryRows(
        `SELECT * FROM (
        SELECT ${selectList}
         ${fromJoin}
         WHERE m.conversation_id = $1 AND m.business_id = $2
         AND (m.created_at, m.message_id) < ($3::timestamptz, $4::text)
         ORDER BY m.created_at DESC, m.message_id DESC
         LIMIT $5
       ) sub
       ORDER BY sub.created_at ASC, sub.message_id ASC`,
        [conversationId, businessId, beforeCreatedAt, beforeMessageId, fetchCount]
      );
    } else {
      messages = await queryRows(
        `SELECT * FROM (
        SELECT ${selectList}
         ${fromJoin}
         WHERE m.conversation_id = $1 AND m.business_id = $2
         ORDER BY m.created_at DESC, m.message_id DESC
         LIMIT $3
       ) sub
       ORDER BY sub.created_at ASC, sub.message_id ASC`,
        [conversationId, businessId, fetchCount]
      );
    }

    const hasMore = messages.length > pageSize;
    const trimmed = hasMore ? messages.slice(0, pageSize) : messages;

    const oldest = trimmed[0] as { created_at?: string; message_id?: string } | undefined;
    const oldestCursor =
      oldest?.created_at && oldest?.message_id
        ? { created_at: oldest.created_at, message_id: oldest.message_id }
        : null;

    // Fetch reactions for all messages in one query
    const messageIds = trimmed.map((m: any) => m.message_id).filter(Boolean);
    let reactionsByMessageId: Record<string, Array<{ reaction: string; sender_jid: string }>> = {};
    if (messageIds.length > 0) {
      try {
        const reactionsResult = await queryRows<{ message_id: string; reaction: string; sender_jid: string }>(
          `SELECT message_id, reaction, sender_jid
           FROM whatsapp_message_reactions
           WHERE business_id = $1 AND message_id = ANY($2) AND reaction != ''`,
          [businessId, messageIds]
        );
        for (const r of reactionsResult) {
          if (!reactionsByMessageId[r.message_id]) reactionsByMessageId[r.message_id] = [];
          reactionsByMessageId[r.message_id].push({ reaction: r.reaction, sender_jid: r.sender_jid });
        }
      } catch (_) {
        // Table may not exist yet in older deployments — ignore
      }
    }

    // Add sender_type to messages
    // Determine sender type: 'customer' (incoming), 'agent' (outgoing from human), 'bot', 'campaign'
    const messagesWithSenderType = trimmed.map((msg: any) => {
      let sender_type: 'customer' | 'agent' | 'bot' | 'campaign' = 'customer';
      
      if (msg.direction === 'outgoing') {
        if (msg.sent_by === 'bot') {
          sender_type = 'bot';
        } else if (msg.sent_by === 'staff') {
          sender_type = 'agent';
        } else if (msg.buttons && Array.isArray(msg.buttons) && msg.buttons.length > 0) {
          sender_type = 'bot'; // Assume bot if buttons present (could be campaign too)
        } else {
          sender_type = 'agent'; // Default to agent for outgoing without buttons
        }
      } else {
        sender_type = 'customer';
      }
      
      return {
        ...msg,
        sender_type,
        reactions: reactionsByMessageId[msg.message_id] || [],
      };
    });

    // A supervisor watching someone else's chat must not clear the owner's unread count.
    const owner = ownershipRow ? liveOwnerId(ownershipRow) : null;
    const updateResult =
      !owner || owner === userId
        ? await query(
            `UPDATE whatsapp_conversations 
             SET unread_count = 0 
             WHERE id = $1 AND business_id = $2 AND unread_count > 0`,
            [conversationId, businessId]
          )
        : { rowCount: 0 };

    // TODO: Emit WebSocket summary update only if rows were affected (unread_count was actually reset)
    if (updateResult.rowCount && updateResult.rowCount > 0) {
      try {
        const { emitSummaryUpdate } = await import('@/lib/whatsapp-websocket');
        // Fetch summary for this business
        // FIX: Count conversations with unread messages, don't sum unread_count
        const summaryResult = await queryRows<{ total: number; unread: number }>(`
          SELECT 
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE unread_count > 0)::int as unread
          FROM whatsapp_conversations
          WHERE business_id = $1 AND status = 'active'
        `, [businessId]);
        
        if (summaryResult.length > 0) {
          emitSummaryUpdate(businessId, {
            total_conversations: summaryResult[0].total || 0,
            unread_conversations: summaryResult[0].unread || 0
          });
        }
      } catch (err) {
        console.error('[API] Error emitting summary update:', err);
      }
    }

    return NextResponse.json({
      messages: messagesWithSenderType,
      has_more: hasMore,
      oldest_cursor: oldestCursor,
      events: loadOlder ? [] : await listOwnershipEvents(businessId, conversationId),
      ownership: ownershipRow ? ownershipView(found.viewer, ownershipRow) : null,
      window: loadOlder ? undefined : await replyWindow(businessId, conversationId, isGroup).catch(() => null),
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withWhatsAppPremiumApi<{ id: string }>({ parseJsonBody: true, inboxPermission: true }, async ({ params, request, businessId, body, userId }) => {
  try {

    const found = await resolveVisibleConversation({ businessId, userId }, params.id);
    if (!found) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    const conversationId = found.id;
    const ownershipRow = await loadOwnership(businessId, conversationId);
    if (!ownershipRow || !canReply(found.viewer, ownershipRow)) {
      const owner = ownershipRow ? liveOwnerId(ownershipRow) : null;
      return NextResponse.json(
        {
          error: owner
            ? `${ownershipRow?.owner_name || 'Another agent'} is handling this chat`
            : 'Click Intervene to reply to this chat',
          code: owner ? 'NOT_OWNER' : 'INTERVENE_REQUIRED',
        },
        { status: 403 }
      );
    }

    const conv = await queryOne<{
      conversation_id: string | null;
      from_number: string | null;
      is_group: boolean | null;
      group_jid: string | null;
      is_blocked: boolean | null;
    }>(
      `SELECT conversation_id, from_number, is_group, group_jid, is_blocked
         FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }
    if (conv.is_blocked) {
      return NextResponse.json(
        { error: 'This contact is blocked. Unblock them to send messages.', code: 'BLOCKED' },
        { status: 409 }
      );
    }
    // Individual chats: conversation_id is the normalized phone; groups: the group JID.
    let toNumber = conv.is_group
      ? conv.group_jid || conv.conversation_id || ''
      : conv.conversation_id || conv.from_number || '';
    if (conv.is_group && toNumber && !toNumber.endsWith('@g.us')) {
      toNumber = `${toNumber}@g.us`;
    }
    
    if (!toNumber) {
      return NextResponse.json(
        { error: 'Cannot determine recipient. Please check conversation settings.' },
        { status: 400 }
      );
    }

    const { message_text, media_url, file_name, buttons, footer } = (body ?? {}) as Record<string, any>;
    const text = typeof message_text === 'string' ? message_text : '';

    if (!text.trim() && !media_url) {
      return NextResponse.json(
        { error: 'message_text or media_url is required' },
        { status: 400 }
      );
    }

    let file: InboxFile | undefined;
    if (media_url) {
      const parsed = typeof media_url === 'string' ? parseDataUrl(media_url) : null;
      if (!parsed || parsed.buffer.length === 0) {
        return NextResponse.json({ error: 'Attach the file again; it could not be read.' }, { status: 400 });
      }
      file = { ...parsed, fileName: safeFileName(file_name, parsed.mimeType) };
    }

    const window = await replyWindow(businessId, conversationId, !!conv.is_group);
    if (!window.open) {
      return NextResponse.json(
        {
          error: 'More than 24 hours have passed since the customer last wrote. Send an approved template to restart the chat.',
          code: 'WINDOW_CLOSED',
          window,
        },
        { status: 409 }
      );
    }

    let sent: Awaited<ReturnType<typeof sendInboxMessage>>;
    try {
      sent = await sendInboxMessage({
        businessId,
        to: toNumber,
        isGroup: !!conv.is_group,
        text,
        file,
        buttons: Array.isArray(buttons) ? buttons : undefined,
        footer: typeof footer === 'string' ? footer : undefined,
      });
    } catch (sendError: any) {
      console.error('Error sending WhatsApp message:', sendError?.message || sendError);
      const status = sendError instanceof InboxSendError ? sendError.status : 502;
      return NextResponse.json(
        { error: sendError?.message || 'Failed to send message via WhatsApp', code: sendError?.code },
        { status }
      );
    }
    const messageId = sent.messageId;

    const storedMediaUrl = file ? await saveInboxMedia(businessId, file.buffer, file.mimeType) : undefined;
    const storedText = text || (file && sent.messageType === 'document' ? file.fileName : '');

    const apiSendTs = Math.floor(Date.now() / 1000);
    await storeOutgoingMessage(
      businessId,
      conversationId,
      toNumber,
      storedText,
      messageId,
      sent.messageType,
      storedMediaUrl,
      buttons ? JSON.stringify(buttons) : undefined,
      apiSendTs,
      null,
      { sentBy: 'staff', sentByUserId: userId ?? null }
    );
    if (!conv.is_group) await onStaffReply(businessId, conversationId).catch(() => undefined);

    // storeOutgoingMessage already updates conversation and emits WebSocket events
    const row = await queryOne<Record<string, unknown>>(
      `SELECT m.id, m.message_id, m.message_text, m.message_type, m.media_url, m.direction, m.status, m.buttons,
              m.created_at, m.source_timestamp, m.sent_by, m.sent_by_user_id, su.name AS sent_by_name
       FROM whatsapp_conversation_messages m
       LEFT JOIN users su ON su.id = m.sent_by_user_id
       WHERE m.business_id = $1 AND m.conversation_id = $2 AND m.message_id = $3
       LIMIT 1`,
      [businessId, conversationId, messageId]
    );

    return NextResponse.json(
      {
        success: true,
        message_id: messageId,
        message: row || null
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error sending message:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});