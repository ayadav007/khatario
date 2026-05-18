/**
 * API endpoint for fetching and sending messages in a conversation
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryRows, query, queryOne } from '@/lib/db';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { resolveWhatsAppConversationDbId } from '@/lib/whatsapp-conversation-resolve';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

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
          , m.source_timestamp`;

    const fromJoin = `FROM whatsapp_conversation_messages m
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
        // Outgoing messages are from agent/bot/campaign
        // Check if message has buttons (likely bot/campaign) or check other metadata
        if (msg.buttons && Array.isArray(msg.buttons) && msg.buttons.length > 0) {
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

    // Mark conversation as read (only if unread_count > 0 to avoid unnecessary DB writes)
    const updateResult = await query(
      `UPDATE whatsapp_conversations 
       SET unread_count = 0 
       WHERE id = $1 AND business_id = $2 AND unread_count > 0`,
      [conversationId, businessId]
    );

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
      oldest_cursor: oldestCursor
    });
  } catch (error: any) {
    console.error('Error fetching messages:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Check if business has WhatsApp Bot addon
    const hasAddon = await hasWhatsAppBotAddon(businessId);
    if (!hasAddon) {
      return NextResponse.json(
        { error: 'WhatsApp Bot addon is required. Please upgrade to unlock this feature.' },
        { status: 403 }
      );
    }

    const conversationId = await resolveWhatsAppConversationDbId(businessId, params.id);
    if (!conversationId) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // Get conversation details (including is_group to determine if it's a group)
    const conversation = await queryRows(
      `SELECT conversation_id, from_number, to_number, is_group, group_jid FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    if (conversation.length === 0) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const conv = conversation[0];
    // For individual chats, conversation_id is the normalized phone number
    // For groups, conversation_id is the group JID (group@g.us) or use group_jid
    let toNumber: string;
    
    if (conv.is_group) {
      // For groups, use group_jid if available, otherwise conversation_id
      toNumber = conv.group_jid || conv.conversation_id;
      // Ensure it has @g.us suffix
      if (toNumber && !toNumber.endsWith('@g.us')) {
        toNumber = `${toNumber}@g.us`;
      }
    } else {
      // For individual chats, use conversation_id or from_number
      toNumber = conv.conversation_id || conv.from_number;
    }
    
    if (!toNumber) {
      return NextResponse.json(
        { error: 'Cannot determine recipient. Please check conversation settings.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { message_text, message_type, media_url, buttons, footer } = body;

    if (!message_text && !media_url) {
      return NextResponse.json(
        { error: 'message_text or media_url is required' },
        { status: 400 }
      );
    }

    // Determine message type
    const msgType = message_type || (media_url ? 'image' : 'text');
    let media: string | Buffer | undefined = media_url;

    // If media_url is a base64 data URL, convert to Buffer
    if (media_url && typeof media_url === 'string' && media_url.startsWith('data:')) {
      const base64Data = media_url.split(',')[1];
      media = Buffer.from(base64Data, 'base64');
    }

    // Send message via WhatsApp
    let messageId: string | undefined;
    try {
      const result = await sendWhatsAppMessage(
        businessId,
        toNumber,
        message_text || '',
        media,
        msgType as 'text' | 'image' | 'button' | 'document',
        buttons,
        footer
      );
      messageId = typeof result === 'string' ? result : undefined;
    } catch (sendError: any) {
      console.error('Error sending WhatsApp message:', sendError);
      // Return a more user-friendly error message
      const errorMessage = sendError.message || 'Failed to send message via WhatsApp';
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    if (!messageId) {
      return NextResponse.json(
        { error: 'Message was sent but no message ID was returned' },
        { status: 500 }
      );
    }

    // Store outgoing message (storeOutgoingMessage handles database insertion and WebSocket events)
    // Note: storeOutgoingMessage expects conversation UUID, not phone number
    const apiSendTs = Math.floor(Date.now() / 1000);
    await storeOutgoingMessage(
      businessId,
      conversationId, // Pass conversation UUID
      toNumber,
      message_text || '',
      messageId,
      msgType,
      media_url,
      buttons ? JSON.stringify(buttons) : undefined,
      apiSendTs,
      null
    );

    // storeOutgoingMessage already updates conversation and emits WebSocket events
    const row = await queryOne<Record<string, unknown>>(
      `SELECT id, message_id, message_text, message_type, media_url, direction, status, buttons, created_at, source_timestamp
       FROM whatsapp_conversation_messages
       WHERE business_id = $1 AND conversation_id = $2 AND message_id = $3
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
}
