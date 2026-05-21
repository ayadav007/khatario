/**
 * WhatsApp CRM Bot Logic
 * Handles incoming messages, conversation state machines, and automated responses
 */

import * as db from '@/lib/db';
import { sendWhatsAppMessage } from './whatsapp';
import { queryRows, queryOne, query } from '@/lib/db';
import { SalesAgentChatbot } from './services/sales-agent-chatbot';
import { LeadAnalyzer } from './services/lead-analyzer';
import { generatePaymentLinkForBusiness } from './services/payment-service';
import {
  evaluatePaymentOcrWithRules,
  verifyPaymentScreenshot
} from './services/payment-ocr-service';

function logTimestampDriftSec(
  normalizedSec: number,
  originalSec: number | null | undefined,
  context: string
): void {
  if (originalSec == null || originalSec <= 0) return;
  const drift = Math.abs(normalizedSec - originalSec);
  if (drift > 5) {
    console.warn(`[CRM] Timestamp drift > 5s [${context}]`, {
      normalizedSec,
      originalSec,
      driftSeconds: drift
    });
  }
}

function logTimestampDriftFromDbRow(
  createdAt: Date | string | null | undefined,
  sourceAt: Date | string | null | undefined,
  context: string
): void {
  if (!createdAt || !sourceAt) return;
  const a = new Date(createdAt).getTime() / 1000;
  const b = new Date(sourceAt).getTime() / 1000;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return;
  if (Math.abs(a - b) > 5) {
    console.warn(`[CRM] Timestamp drift > 5s (created_at vs source_timestamp) [${context}]`, {
      created_at: createdAt,
      source_timestamp: sourceAt,
      driftSeconds: Math.abs(a - b)
    });
  }
}

/**
 * Round-robin auto-assignment: if enabled in business_settings, assigns the
 * newly created conversation to the next agent in the pool and advances the
 * pointer atomically. Skips assignment for group chats.
 */
async function autoAssignConversation(
  businessId: string,
  conversationId: string,
  isGroup: boolean
): Promise<void> {
  if (isGroup) return;

  try {
    const settings = await queryOne<{
      whatsapp_auto_assign_enabled: boolean;
      whatsapp_auto_assign_agent_ids: string[];
      whatsapp_auto_assign_last_index: number;
    }>(
      `SELECT whatsapp_auto_assign_enabled,
              whatsapp_auto_assign_agent_ids,
              whatsapp_auto_assign_last_index
       FROM business_settings
       WHERE business_id = $1`,
      [businessId]
    );

    if (!settings?.whatsapp_auto_assign_enabled) return;
    const pool: string[] = Array.isArray(settings.whatsapp_auto_assign_agent_ids)
      ? settings.whatsapp_auto_assign_agent_ids
      : [];
    if (pool.length === 0) return;

    const idx = (settings.whatsapp_auto_assign_last_index || 0) % pool.length;
    const agentId = pool[idx];
    const nextIdx = (idx + 1) % pool.length;

    // Assign conversation and advance pointer atomically
    await Promise.all([
      query(
        `UPDATE whatsapp_conversations SET assigned_to = $1 WHERE id = $2`,
        [agentId, conversationId]
      ),
      query(
        `UPDATE business_settings SET whatsapp_auto_assign_last_index = $1 WHERE business_id = $2`,
        [nextIdx, businessId]
      ),
    ]);

    console.log(`[CRM] Auto-assigned conversation ${conversationId} to agent ${agentId} (pool idx ${idx})`);
  } catch (e) {
    console.warn('[CRM] autoAssignConversation failed (non-fatal):', e);
  }
}

/** Fetch + cache profile picture for a conversation (fire-and-forget). */
function cacheProfilePicture(
  businessId: string,
  conversationDbId: string,
  conversationId: string,
  fromJid: string,
  isGroup: boolean,
): void {
  setImmediate(async () => {
    try {
      const jidForPic = isGroup
        ? (conversationId.includes('@') ? conversationId : `${conversationId}@g.us`)
        : (fromJid.includes('@') ? fromJid : `${fromJid}@s.whatsapp.net`);

      const { fetchProfilePicture } = await import('./whatsapp-profile-pictures');
      const url = await fetchProfilePicture(businessId, jidForPic, null, isGroup);
      if (url) {
        await query(
          `UPDATE whatsapp_conversations
           SET profile_picture_url = $1, profile_picture_updated_at = NOW()
           WHERE id = $2 AND business_id = $3`,
          [url, conversationDbId, businessId]
        );
      }
    } catch (_) { /* non-critical */ }
  });
}

/** Refresh profile picture only if it was last updated more than 7 days ago. */
function refreshProfilePictureIfStale(
  businessId: string,
  conversationDbId: string,
  conversationId: string,
  fromJid: string,
  isGroup: boolean,
): void {
  setImmediate(async () => {
    try {
      const row = await queryOne<{ profile_picture_updated_at: Date | null }>(
        `SELECT profile_picture_updated_at FROM whatsapp_conversations WHERE id = $1`,
        [conversationDbId]
      );
      const lastUpdate = row?.profile_picture_updated_at;
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (lastUpdate && lastUpdate > sevenDaysAgo) return; // Still fresh

      cacheProfilePicture(businessId, conversationDbId, conversationId, fromJid, isGroup);
    } catch (_) { /* non-critical */ }
  });
}

// Conversation state types
export type ConversationState = 
  | 'idle' 
  | 'waiting_item_name' 
  | 'waiting_quantity' 
  | 'waiting_confirm' 
  | 'creating_invoice'
  | 'waiting_price_query'
  | 'waiting_stock_query'
  | 'waiting_balance_query'
  | 'waiting_for_option'
  | 'waiting_customer_name'
  | 'waiting_customer_phone'
  | 'waiting_customer_address'
  | 'waiting_payment';

interface ConversationContext {
  items?: Array<{ name: string; quantity: number; price?: number; item_id?: string }>;
  current_item?: string;
  invoice_id?: string;
  query_type?: 'price' | 'stock' | 'balance';
  waiting_rule_id?: string;
  [key: string]: any; // Allow dynamic properties for context variables
}

/**
 * Universal function to extract phone number from Baileys JID
 * Handles ALL Baileys JID formats: @s.whatsapp.net, @c.us, @g.us, @lid, @broadcast, @status
 * 
 * @param jid - The JID string from Baileys (e.g., "919876543210:0@s.whatsapp.net", "919876543210@c.us")
 * @returns Extracted phone number (digits only, 9-15 digits) or empty string if invalid
 */
function extractPhoneFromJid(jid: string): string {
  if (!jid) return '';

  // Baileys can return ANY of these domains: @s.whatsapp.net, @c.us, @g.us, @lid, @broadcast, @status
  // Normalize by removing ALL domain suffixes, device IDs, and non-digits
  const cleaned = jid
    .replace(/@.*$/, '')   // Remove any domain suffix (@s.whatsapp.net, @c.us, @lid, etc.)
    .replace(/:.*/, '')    // Remove device ID (:0, :29, :device, etc.)
    .replace(/\D/g, '');   // Keep only digits

  // Phone numbers are 9-15 digits (international format)
  if (cleaned.length < 9 || cleaned.length > 15) {
    return '';
  }

  return cleaned;
}

/**
 * Store or update incoming message
 */
/**
 * @param sourceTimestampSec — Normalized seconds for `created_at` (e.g. from `getTimestamp`); falls back to server time.
 * @param originalWaTimestampSec — Proto `messageTimestamp` when parseable, stored in `source_timestamp` for audit/drift.
 */
export async function storeIncomingMessage(
  businessId: string,
  fromJid: string, // Full JID (can be phone@s.whatsapp.net or group@g.us)
  toNumber: string,
  messageText: string,
  messageId: string,
  messageType: string = 'text',
  mediaUrl?: string,
  isGroup: boolean = false,
  groupName?: string,
  groupJid?: string,
  whatsappDisplayName?: string, // WhatsApp display name (pushName) - may be from phone address book or profile
  sourceTimestampSec?: number | null,
  originalWaTimestampSec?: number | null
) {
  console.log('[CRM] 📝 storeIncomingMessage called:', {
    businessId,
    fromJid,
    toNumber,
    messageText: messageText.substring(0, 50),
    messageId,
    messageType,
    isGroup,
    groupName
  });
  // Determine conversation ID based on whether it's a group
  let conversationId: string;
  let normalizedFrom: string;
  let normalizedTo: string;
  
  // Helper function to extract phone number from JID
  // Universal extraction function that handles all Baileys JID formats
  const extractPhoneFromJid = (jid: string): string => {
    if (!jid) return '';

    // Step 1: Remove domain (@s.whatsapp.net / @c.us / @g.us / others)
    // Split by '@' and take the first part (everything before domain)
    let base = jid.split('@')[0];

    // Step 2: Remove device ID if present (e.g., ":0", ":12", ":55")
    // Split by ':' and take the first part (phone number before device ID)
    base = base.split(':')[0];

    // Step 3: Keep digits only (remove any non-numeric characters)
    const phone = base.replace(/\D/g, '');

    // Step 4: Validate length (8-15 digits for valid international mobile numbers)
    if (phone.length < 8 || phone.length > 15) {
      return '';
    }

    return phone;
  };

  // Group id must never be empty — unique constraint is (business_id, conversation_id).
  // Callers sometimes pass participant as fromJid but omit groupJid (e.g. messaging-history.set).
  const effectiveGroupJid =
    groupJid ||
    (isGroup && fromJid && fromJid.endsWith('@g.us') ? fromJid : undefined);

  if (isGroup && effectiveGroupJid) {
    // For groups, use the group JID as conversation_id
    conversationId = effectiveGroupJid;
    // fromJid is usually the participant JID; if it's the group @g.us, phone extraction yields ''
    normalizedFrom = extractPhoneFromJid(fromJid);
    normalizedTo = extractPhoneFromJid(toNumber);
  } else {
    // For individual chats, fromJid should be phone:0@s.whatsapp.net or phone@s.whatsapp.net
    normalizedFrom = extractPhoneFromJid(fromJid);
    normalizedTo = extractPhoneFromJid(toNumber);
    conversationId = normalizedFrom;
  }

  if (isGroup && (!conversationId || !conversationId.trim())) {
    console.error('[CRM] Refusing to store group message: missing group conversation_id', {
      businessId,
      fromJid,
      groupJid,
      effectiveGroupJid,
    });
    throw new Error('Group message missing group JID (conversation_id)');
  }
  if (!isGroup && (!conversationId || !conversationId.trim())) {
    console.error('[CRM] Refusing to store message: empty conversation_id', { businessId, fromJid });
    throw new Error('Invalid conversation_id for message');
  }

  try {
    // Find or create conversation
    // For groups: match by conversation_id (group JID) and is_group=true
    // For individuals: try exact match first, then normalized phone number matching
    let conversation = await queryOne<{ id: string; customer_id?: string; is_blocked?: boolean }>(
      isGroup 
        ? `SELECT id, customer_id, is_blocked FROM whatsapp_conversations 
           WHERE business_id = $1 AND conversation_id = $2 AND is_group = true
           LIMIT 1`
        : `SELECT id, customer_id, is_blocked FROM whatsapp_conversations 
           WHERE business_id = $1 
             AND (
               conversation_id = $2 
               OR (NOT is_group AND (
                 conversation_id = $3
                 OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $3
                 OR from_number = $3
                 OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $3
               ))
             )
           LIMIT 1`,
      isGroup ? [businessId, conversationId.trim()] : [businessId, conversationId, normalizedFrom]
    );
    
    console.log('[CRM] 🔍 Conversation lookup result:', {
      found: !!conversation,
      conversationId,
      isGroup,
      normalizedFrom: isGroup ? '(N/A for groups)' : normalizedFrom
    });

    if (!conversation) {
      // Try to find customer by phone number
      const customer = await queryOne<{ id: string }>(
        `SELECT id FROM customers WHERE business_id = $1 AND phone = $2 LIMIT 1`,
        [businessId, normalizedFrom]
      );

      // Create new conversation
      const newConv = await queryOne<{ id: string }>(
        `INSERT INTO whatsapp_conversations 
         (business_id, from_number, to_number, conversation_id, last_message_text, 
          last_message_at, last_message_direction, customer_id, status, is_group, group_name, group_jid, whatsapp_display_name)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, 'incoming', $6, 'active', $7, $8, $9, $10)
         RETURNING id`,
        [
          businessId, 
          normalizedFrom, 
          normalizedTo, 
          conversationId, 
          messageText, 
          customer?.id || null,
          isGroup,
          groupName || null,
          (isGroup ? effectiveGroupJid : groupJid) || null,
          (whatsappDisplayName && whatsappDisplayName.trim()) ? whatsappDisplayName.trim() : null
        ]
      );
      conversation = { id: newConv!.id, customer_id: customer?.id };
      // Fire-and-forget: auto-assign to next agent in pool if enabled
      autoAssignConversation(businessId, newConv!.id, isGroup).catch(() => {});
      // Fire-and-forget: cache profile picture for new conversation
      cacheProfilePicture(businessId, newConv!.id, conversationId, fromJid, isGroup);
    } else {
      // Refresh profile picture in background if not updated recently (> 7 days)
      refreshProfilePictureIfStale(businessId, conversation.id, conversationId, fromJid, isGroup);
    }
    
    // Check if conversation is blocked before updating
    if (conversation.is_blocked) {
      console.log(`[CRM] Message from blocked conversation ${conversationId} ignored`);
      throw new Error('Conversation is blocked');
    }

    const normSec =
      sourceTimestampSec != null && sourceTimestampSec > 0
        ? sourceTimestampSec
        : Math.floor(Date.now() / 1000);
    const origSec =
      originalWaTimestampSec != null && originalWaTimestampSec > 0 ? originalWaTimestampSec : null;
    logTimestampDriftSec(normSec, origSec, 'storeIncomingMessage');

    const lastMessageAtField = 'last_message_at = to_timestamp($2::double precision)';
    const updateFields: string[] = [
      'last_message_text = $1',
      lastMessageAtField,
      'last_message_direction = \'incoming\'',
      'unread_count = LEAST(unread_count + 1, 999)',
      'updated_at = CURRENT_TIMESTAMP'
    ];
    const updateValues: any[] = [messageText, normSec];
    let paramIndex = 3;
    
    // Always update group status and metadata if it's a group
    if (isGroup) {
      updateFields.push(`is_group = true`);
      if (groupName) {
        updateFields.push(`group_name = $${paramIndex++}`);
        updateValues.push(groupName);
      }
      if (effectiveGroupJid) {
        updateFields.push(`group_jid = $${paramIndex++}`);
        updateValues.push(effectiveGroupJid);
      }
    } else {
      // Ensure is_group is false for individual chats
      updateFields.push(`is_group = false`);
      // For individual chats, update from_number to match the correctly extracted normalized phone
      // This fixes any old incorrect values
      updateFields.push(`from_number = $${paramIndex++}`);
      updateValues.push(normalizedFrom);
      // Update WhatsApp display name if provided (for individual chats only)
      if (whatsappDisplayName && whatsappDisplayName.trim()) {
        updateFields.push(`whatsapp_display_name = $${paramIndex++}`);
        updateValues.push(whatsappDisplayName.trim());
      }
    }
    updateValues.push(conversation.id);
    const idParamIndex = paramIndex;
    await db.query(
      `UPDATE whatsapp_conversations 
       SET ${updateFields.join(', ')}
       WHERE id = $${idParamIndex}`,
      updateValues
    );

    const senderName = isGroup && whatsappDisplayName ? whatsappDisplayName : null;

    const skipConversationMessageMirror =
      process.env.WHATSAPP_SKIP_CONVERSATION_MESSAGE_MIRROR === 'true' ||
      process.env.WHATSAPP_SKIP_CONVERSATION_MESSAGE_MIRROR === '1';

    let messageResult: { rows: { created_at?: Date }[] };

    if (skipConversationMessageMirror) {
      messageResult = {
        rows: [
          {
            created_at: new Date(normSec * 1000)
          }
        ]
      };
      console.log('[CRM] WHATSAPP_SKIP_CONVERSATION_MESSAGE_MIRROR: skipping whatsapp_conversation_messages insert');
    } else {
      messageResult = await db.query(
        `INSERT INTO whatsapp_conversation_messages 
         (business_id, conversation_id, message_id, from_number, to_number, 
          message_text, message_type, media_url, direction, status, sender_name, created_at, source_timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'incoming', 'delivered', $9, to_timestamp($10::double precision),
          CASE WHEN $11::double precision IS NOT NULL AND $11::double precision > 0
            THEN to_timestamp($11::double precision) ELSE NULL END)
         ON CONFLICT (message_id) DO UPDATE SET
           sender_name = COALESCE(EXCLUDED.sender_name, whatsapp_conversation_messages.sender_name)
         RETURNING created_at, source_timestamp`,
        [
          businessId,
          conversation.id,
          messageId,
          normalizedFrom,
          normalizedTo,
          messageText,
          messageType,
          mediaUrl || null,
          senderName,
          normSec,
          origSec
        ]
      );
    }
    
    if (messageResult.rows && messageResult.rows.length > 0) {
      const messageCreatedAt = messageResult.rows[0].created_at;
      if (messageCreatedAt) {
        await db.query(
          `UPDATE whatsapp_conversations 
           SET last_message_at = COALESCE(GREATEST(last_message_at, $1), $1)
           WHERE id = $2 AND (last_message_at IS NULL OR last_message_at < $1)`,
          [messageCreatedAt, conversation.id]
        );
      }
    }

    // Emit WebSocket events to notify connected clients
    try {
      // Get full conversation data for the update event
      const conversationData = await db.queryOne<any>(`
        SELECT 
          c.id,
          c.conversation_id,
          c.from_number,
          c.last_message_text,
          c.last_message_at,
          c.last_message_direction,
          c.unread_count,
          c.assigned_to,
          c.conversation_status,
          c.lead_status,
          c.is_group,
          c.group_name,
          u.name as assigned_agent_name
        FROM whatsapp_conversations c
        LEFT JOIN users u ON c.assigned_to = u.id
        WHERE c.id = $1 AND c.business_id = $2
      `, [conversation.id, businessId]);

      // Get message data if message was inserted (or if it already exists)
      // Try to get the message - it might have been inserted or might already exist
      let messageData = null;
      
      if (skipConversationMessageMirror) {
        const ts = messageResult.rows[0]?.created_at || new Date();
        messageData = {
          id: messageId,
          message_id: messageId,
          message_text: messageText,
          message_type: messageType,
          media_url: mediaUrl || null,
          direction: 'incoming',
          status: 'delivered',
          buttons: null,
          created_at: ts instanceof Date ? ts.toISOString() : ts,
          source_timestamp: origSec != null ? new Date(origSec * 1000).toISOString() : null
        };
      } else if (messageResult.rows && messageResult.rows.length > 0) {
        messageData = await db.queryOne<any>(`
          SELECT id, message_id, message_text, message_type, media_url, direction, status, buttons, created_at, source_timestamp
          FROM whatsapp_conversation_messages
          WHERE conversation_id = $1 AND message_id = $2
          ORDER BY created_at DESC, message_id DESC
          LIMIT 1
        `, [conversation.id, messageId]);
      } else {
        messageData = await db.queryOne<any>(`
          SELECT id, message_id, message_text, message_type, media_url, direction, status, buttons, created_at, source_timestamp
          FROM whatsapp_conversation_messages
          WHERE conversation_id = $1 AND message_id = $2
          ORDER BY created_at DESC, message_id DESC
          LIMIT 1
        `, [conversation.id, messageId]);
      }

      // Always emit so SSE clients can merge — DB row is source of truth; if SELECT misses, use the same fields we just wrote
      if (messageData) {
        logTimestampDriftFromDbRow(
          messageData.created_at,
          messageData.source_timestamp,
          'storeIncomingMessage emit'
        );
        console.log('[CRM] ✅ Found message data, emitting WebSocket event:', {
          messageId: messageData.id || messageData.message_id,
          conversationId: conversation.id
        });
        const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
        emitNewMessage(businessId, conversation.id, messageData);
      } else {
        const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
        const ts = messageResult.rows[0]?.created_at || new Date(normSec * 1000);
        const fallback = {
          id: messageId,
          message_id: messageId,
          message_text: messageText,
          message_type: messageType,
          media_url: mediaUrl || null,
          direction: 'incoming' as const,
          status: 'delivered',
          buttons: null,
          created_at: ts instanceof Date ? ts.toISOString() : String(ts),
          source_timestamp: origSec != null ? new Date(origSec * 1000).toISOString() : null
        };
        console.warn(
          `[CRM] ⚠️ DB row not re-read; emitNewMessage (fallback) for ${messageId} conv ${conversation.id}`
        );
        emitNewMessage(businessId, conversation.id, fallback);
      }

      // Emit conversation update
      if (conversationData) {
        const { emitConversationUpdate } = await import('@/lib/whatsapp-websocket');
        emitConversationUpdate(businessId, conversationData);
      }

      // Emit summary update (for unread counts)
      const { emitSummaryUpdate } = await import('@/lib/whatsapp-websocket');
      const summaryResult = await db.queryRows<{ total: number; unread: number }>(`
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
      // Non-critical: WebSocket notification failure shouldn't break message storage
      console.error('[CRM] Error emitting WebSocket events:', err);
    }

    return { conversationId: conversation.id, customerId: conversation.customer_id };
  } catch (error: any) {
    console.error('[CRM] Error storing incoming message:', error);
    throw error;
  }
}

/**
 * Store outgoing message
 * @param originalWaTimestampSec — Proto time when available (e.g. extract on WAMessage); optional `source_timestamp` column
 */
export async function storeOutgoingMessage(
  businessId: string,
  conversationId: string, // Conversation UUID
  toNumber: string,
  messageText: string,
  messageId: string,
  messageType: string = 'text',
  mediaUrl?: string,
  buttons?: string, // JSON string of buttons array
  sourceTimestampSec?: number | null,
  originalWaTimestampSec?: number | null
) {
  const normalizedTo = extractPhoneFromJid(toNumber);

  try {
    // Get conversation
    const conversation = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // Parse buttons if provided
    let buttonsJson: any = null;
    if (buttons) {
      try {
        buttonsJson = typeof buttons === 'string' ? JSON.parse(buttons) : buttons;
      } catch (e) {
        console.warn('[CRM] Invalid buttons JSON, storing as null:', e);
      }
    }

    const normSec =
      sourceTimestampSec != null && sourceTimestampSec > 0
        ? sourceTimestampSec
        : Math.floor(Date.now() / 1000);
    const origSec =
      originalWaTimestampSec != null && originalWaTimestampSec > 0 ? originalWaTimestampSec : null;
    logTimestampDriftSec(normSec, origSec, 'storeOutgoingMessage');

    const mid = messageId || `out_${Date.now()}_${Math.random()}`;
    const btn = buttonsJson ? JSON.stringify(buttonsJson) : null;
    const result = await queryOne<{ id: string }>(
      `INSERT INTO whatsapp_conversation_messages 
       (business_id, conversation_id, message_id, from_number, to_number, 
        message_text, message_type, media_url, direction, status, buttons, created_at, source_timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'outgoing', 'sent', $9, to_timestamp($10::double precision),
         CASE WHEN $11::double precision IS NOT NULL AND $11::double precision > 0
           THEN to_timestamp($11::double precision) ELSE NULL END)
         ON CONFLICT (message_id) DO UPDATE SET
         message_text = EXCLUDED.message_text,
         message_type = EXCLUDED.message_type,
         media_url = EXCLUDED.media_url,
         buttons = EXCLUDED.buttons,
         status = 'sent'
       RETURNING id`,
      [
        businessId,
        conversation.id,
        mid,
        normalizedTo,
        normalizedTo,
        messageText,
        messageType,
        mediaUrl || null,
        btn,
        normSec,
        origSec
      ]
    );

    await db.query(
      `UPDATE whatsapp_conversations 
       SET last_message_text = $1, last_message_at = to_timestamp($3::double precision), 
           last_message_direction = 'outgoing', updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [messageText, conversation.id, normSec]
    );

    // Log automation event if buttons present (bot/campaign message)
    if (buttonsJson && Array.isArray(buttonsJson) && buttonsJson.length > 0) {
      await logAutomationEvent(
        conversation.id,
        businessId,
        'bot_message',
        {
          message_type: messageType,
          has_buttons: true,
          button_count: buttonsJson.length
        }
      );
    }

    // Emit WebSocket events to notify connected clients
    try {
      // Get full conversation data for the update event
      const conversationData = await db.queryOne<any>(`
        SELECT 
          c.id,
          c.conversation_id,
          c.from_number,
          c.last_message_text,
          c.last_message_at,
          c.last_message_direction,
          c.unread_count,
          c.assigned_to,
          c.conversation_status,
          c.lead_status,
          c.is_group,
          c.group_name,
          u.name as assigned_agent_name
        FROM whatsapp_conversations c
        LEFT JOIN users u ON c.assigned_to = u.id
        WHERE c.id = $1 AND c.business_id = $2
      `, [conversation.id, businessId]);

      // Get message data
      const storedMessageId = result?.id;
      if (storedMessageId) {
        const messageData = await db.queryOne<any>(`
          SELECT id, message_id, message_text, message_type, media_url, direction, status, buttons, created_at, source_timestamp
          FROM whatsapp_conversation_messages
          WHERE id = $1
        `, [storedMessageId]);

        if (messageData) {
          logTimestampDriftFromDbRow(
            messageData.created_at,
            messageData.source_timestamp,
            'storeOutgoingMessage emit'
          );
          const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
          emitNewMessage(businessId, conversationId, messageData);
        } else {
          const { emitNewMessage } = await import('@/lib/whatsapp-websocket');
          const fallback = {
            id: storedMessageId,
            message_id: mid,
            message_text: messageText,
            message_type: messageType,
            media_url: mediaUrl || null,
            direction: 'outgoing' as const,
            status: 'sent',
            buttons: btn,
            created_at: new Date(normSec * 1000).toISOString(),
            source_timestamp: origSec != null ? new Date(origSec * 1000).toISOString() : null
          };
          console.warn(
            '[CRM] storeOutgoingMessage: SELECT after insert missed; emitNewMessage (fallback)',
            { conversationId, messageId: mid }
          );
          emitNewMessage(businessId, conversationId, fallback);
        }
      }

      // Emit conversation update
      if (conversationData) {
        const { emitConversationUpdate } = await import('@/lib/whatsapp-websocket');
        emitConversationUpdate(businessId, conversationData);
      }

      // Emit summary update (for unread counts)
      const { emitSummaryUpdate } = await import('@/lib/whatsapp-websocket');
      const summaryResult = await db.queryRows<{ total: number; unread: number }>(`
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
      console.error('[CRM] Error emitting WebSocket / SSE events (message stored):', err);
    }

    return result?.id;
  } catch (error: any) {
    console.error('[CRM] Error storing outgoing message:', error);
    throw error;
  }
}

/**
 * Log automation event to timeline
 */
export async function logAutomationEvent(
  conversationId: string, // Conversation UUID
  businessId: string,
  eventType: 'bot_message' | 'button_clicked' | 'flow_entered' | 'flow_exited' | 'cta_clicked' | 'campaign_triggered',
  eventData: Record<string, any> = {}
) {
  try {
    const { query } = await import('@/lib/db');
    // Remove ON CONFLICT since there's no unique constraint - just insert directly
    // Multiple events for same conversation are allowed (one per bot message)
    const result = await query(
      `INSERT INTO whatsapp_automation_events 
       (conversation_id, business_id, event_type, event_data)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [conversationId, businessId, eventType, JSON.stringify(eventData)]
    );
    
    if (result && result.rowCount && result.rowCount > 0) {
      console.log('[CRM] ✅ Automation event logged successfully:', {
        eventType,
        conversationId: conversationId.substring(0, 8) + '...',
        businessId: businessId.substring(0, 8) + '...',
        eventId: result.rows[0]?.id
      });
    } else {
      console.warn('[CRM] ⚠️ Automation event insert returned no rows (possibly duplicate)');
    }
  } catch (error: any) {
    // Non-critical: Logging failure shouldn't break main flow, but log details for debugging
    console.error('[CRM] ❌ Error logging automation event:', {
      error: error.message,
      conversationId: conversationId.substring(0, 8) + '...',
      businessId: businessId.substring(0, 8) + '...',
      eventType,
      stack: error.stack
    });
  }
}

/**
 * Get or create conversation state
 */
async function getConversationState(
  businessId: string,
  conversationId: string
): Promise<{ state: ConversationState; context: ConversationContext } | null> {
  const state = await queryOne<{ state: ConversationState; context: ConversationContext }>(
    `SELECT state, context FROM whatsapp_conversation_states 
     WHERE business_id = $1 AND conversation_id = $2`,
    [businessId, conversationId]
  );

  if (state) {
    return {
      state: state.state,
      context: typeof state.context === 'string' ? JSON.parse(state.context) : (state.context || {})
    };
  }

  return null;
}

/**
 * Update conversation state
 */
async function updateConversationState(
  businessId: string,
  conversationId: string,
  state: ConversationState,
  context: ConversationContext
) {
  await db.query(
    `INSERT INTO whatsapp_conversation_states 
     (business_id, conversation_id, state, context, last_interaction_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, conversation_id) 
     DO UPDATE SET state = $3, context = $4, last_interaction_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP`,
    [businessId, conversationId, state, JSON.stringify(context)]
  );
}

/**
 * Clear conversation state (return to idle)
 */
async function clearConversationState(businessId: string, conversationId: string) {
  await db.query(
    `DELETE FROM whatsapp_conversation_states 
     WHERE business_id = $1 AND conversation_id = $2`,
    [businessId, conversationId]
  );
}

/** Integrated UPI collect session still open or under review → do not treat as manual-only OCR path. */
async function hasPendingGatewayPaymentTransaction(
  businessId: string,
  orderId: string
): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM payment_transactions
       WHERE business_id = $1
         AND order_id = $2
         AND method = 'upi_collect'
         AND status IN ('pending', 'requires_review')
     ) AS exists`,
    [businessId, orderId]
  );
  return Boolean(row?.exists);
}

/** Grace before OCR fallback while PSP webhook may still set payment_status */
const WHATSAPP_PAYMENT_WEBHOOK_GRACE_MS =
  Number.parseInt(process.env.WHATSAPP_PAYMENT_WEBHOOK_GRACE_MS || '', 10) || 15 * 60 * 1000;

function parseIsoMs(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso.trim()) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function isWebhookGraceExceeded(
  waitingSinceIso: unknown,
  orderUpdatedAt: Date | string | null | undefined
): boolean {
  const fromCtx = parseIsoMs(waitingSinceIso);
  const fromOrder =
    orderUpdatedAt != null ? new Date(orderUpdatedAt).getTime() : NaN;
  const baseMs =
    fromCtx ?? (Number.isFinite(fromOrder) ? fromOrder : null);
  if (baseMs == null) return true;
  return Date.now() - baseMs >= WHATSAPP_PAYMENT_WEBHOOK_GRACE_MS;
}

async function formatDraftOrderConfirmationLines(orderId: string): Promise<string> {
  const orderItems = await queryRows<{
    item_name: string;
    qty: number | string;
    line_total: string | number | null;
  }>(
    `SELECT item_name, qty, unit_price, line_total
     FROM sales_order_items
     WHERE sales_order_id = $1
     ORDER BY id ASC`,
    [orderId]
  );
  return orderItems
    .map(
      (item, idx) =>
        `${idx + 1}. ${item.item_name} × ${item.qty} = ₹${parseFloat(String(item.line_total ?? 0))}`
    )
    .join('\n');
}

function whatsAppOrderConfirmedMessage(itemsList: string, grandTotal: number): string {
  return `✅ Payment received! Your order has been confirmed.\n\n📦 *Order Details:*\n${itemsList}\n\n💰 *Total: ₹${grandTotal}*\n\nThank you for your order! We'll process it shortly.`;
}

/**
 * One-time notice when PSP aggregate shows partial settlement (not full paid).
 */
async function maybeNotifyPartialPaymentReceived(params: {
  businessId: string;
  conversationId: string;
  normalizedFrom: string;
}): Promise<{ response?: string; shouldStore?: boolean } | null> {
  const { businessId, conversationId, normalizedFrom } = params;

  const order = await queryOne<{
    id: string;
    grand_total: string;
    payment_status: string | null;
    ocr_data: Record<string, unknown> | null;
  }>(
    `SELECT id, grand_total::text, payment_status, ocr_data
     FROM sales_orders
     WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [businessId, conversationId]
  );

  if (!order) return null;

  const ps = order.payment_status || '';
  if (ps !== 'partial' && ps !== 'partial_paid') return null;

  const od = order.ocr_data as Record<string, unknown> | undefined;
  if (od?.whatsapp_partial_payment_notified === true) return null;

  const paidAgg = await queryOne<{ s: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0)::text AS s
     FROM payment_transactions
     WHERE business_id = $1 AND order_id = $2`,
    [businessId, order.id]
  );
  const paidSum = paidAgg ? parseFloat(paidAgg.s) : 0;
  const grandTotal = parseFloat(order.grand_total);
  const remaining = Math.max(0, grandTotal - paidSum);

  console.log('[CRM] partial_payment_notify', {
    order_id: order.id,
    total_paid: paidSum,
    grand_total: grandTotal,
    remaining,
  });

  await query(
    `UPDATE sales_orders
     SET ocr_data = COALESCE(ocr_data, '{}'::jsonb)
         || jsonb_build_object(
           'whatsapp_partial_payment_notified', true,
           'whatsapp_partial_payment_notified_at', to_jsonb((NOW() AT TIME ZONE 'UTC')::text)
         ),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [order.id]
  );

  return {
    response: `We've recorded a partial payment (₹${paidSum.toFixed(2)} of ₹${grandTotal.toFixed(2)}). Balance due: ₹${remaining.toFixed(2)}. Please complete the remaining payment when ready.`,
    shouldStore: true
  };
}

/**
 * Webhook-first: if sales_orders.payment_status is already `paid`, confirm once (idempotent UPDATE).
 */
async function maybeConfirmWhatsAppOrderIfPaidByWebhook(params: {
  businessId: string;
  whatsappConversationUuid: string;
  normalizedFrom: string;
}): Promise<{ response?: string; shouldStore?: boolean } | null> {
  const { businessId, whatsappConversationUuid, normalizedFrom } = params;

  const order = await queryOne<{
    id: string;
    order_number: string;
    grand_total: string;
    payment_status: string | null;
    ocr_data: Record<string, unknown> | null;
  }>(
    `SELECT id, order_number, grand_total::text, payment_status, ocr_data
     FROM sales_orders
     WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [businessId, whatsappConversationUuid]
  );

  if (!order || order.payment_status !== 'paid') return null;

  const od = order.ocr_data as Record<string, unknown> | undefined;
  if (od?.whatsapp_order_confirmed === true) {
    await clearConversationState(businessId, normalizedFrom);
    return {
      response: 'Your payment is already confirmed. Thank you!',
      shouldStore: true
    };
  }

  const confirmed = await queryOne<{ id: string }>(
    `UPDATE sales_orders
     SET          ocr_data = COALESCE(ocr_data, '{}'::jsonb)
         || jsonb_build_object(
           'whatsapp_order_confirmed', true,
           'whatsapp_order_confirmed_via', 'payment_status_webhook',
           'whatsapp_order_confirmed_at', to_jsonb((NOW() AT TIME ZONE 'UTC')::text),
           'verification_source', 'psp_webhook',
           'ocr_not_applicable_reason', 'payment_confirmed_by_provider'
         ),
         ocr_status = 'verified',
         notes = CASE
           WHEN notes IS NULL OR trim(notes) = '' THEN 'Payment confirmed via webhook (payment_status=paid)'
           ELSE notes
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND payment_status = 'paid'
       AND status = 'draft'
       AND (
         ocr_data IS NULL
         OR ocr_data->>'whatsapp_order_confirmed' IS NULL
         OR (ocr_data->>'whatsapp_order_confirmed') NOT IN ('true', '1')
       )
     RETURNING id`,
    [order.id]
  );

  if (!confirmed) {
    await clearConversationState(businessId, normalizedFrom);
    return {
      response: 'Your payment is already confirmed. Thank you!',
      shouldStore: true
    };
  }

  const itemsList = await formatDraftOrderConfirmationLines(order.id);
  const grandTotal = parseFloat(order.grand_total);
  await clearConversationState(businessId, normalizedFrom);
  return {
    response: whatsAppOrderConfirmedMessage(itemsList, grandTotal),
    shouldStore: true
  };
}

/**
 * Search items by name
 */
async function searchItems(businessId: string, query: string) {
  return await queryRows<{ id: string; name: string; code?: string; selling_price: number; current_stock: number }>(
    `SELECT id, name, code, selling_price, current_stock 
     FROM items 
     WHERE business_id = $1 
     AND (name ILIKE $2 OR code ILIKE $2)
     AND (is_active IS NULL OR is_active = true)
     ORDER BY name ASC
     LIMIT 5`,
    [businessId, `%${query}%`]
  );
}

/**
 * Create cash sale invoice via WhatsApp bot
 */
async function createCashSaleInvoice(
  businessId: string,
  items: Array<{ item_id: string; quantity: number; price?: number; name?: string }>,
  customerId?: string
): Promise<{ invoice_id: string; invoice_number: string }> {
  const { queryOne, queryRows, getPool } = await import('@/lib/db');
  const { checkLimitInTransaction } = await import('@/lib/subscription');
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // CRITICAL: Check subscription limit INSIDE transaction with locking
    // This prevents WhatsApp bot from bypassing invoice limits
    const limitCheck = await checkLimitInTransaction(client, businessId, 'invoices');
    
    if (!limitCheck.allowed) {
      // Subscription limit exceeded - rollback transaction
      await client.query('ROLLBACK');
      client.release();
      throw new Error(limitCheck.message || 'Invoice limit reached. Cannot create invoice via WhatsApp bot.');
    }

    // Limit check passed - proceed with invoice creation

    // Get business settings for invoice number
    const business = await queryOne<{ next_invoice_number: number; invoice_prefix: string }>(
      `SELECT next_invoice_number, invoice_prefix FROM businesses WHERE id = $1`,
      [businessId]
    );

    if (!business) {
      throw new Error('Business not found');
    }

    const invoiceNumber = `${business.invoice_prefix || 'INV'}-${String(business.next_invoice_number).padStart(4, '0')}`;

    // Fetch item details
    const invoiceItems = [];
    let subtotal = 0;
    let taxTotal = 0;
    let cgstTotal = 0;
    let sgstTotal = 0;
    let igstTotal = 0;

    for (const itemInput of items) {
      const item = await queryOne<{
        id: string;
        name: string;
        selling_price: number;
        tax_rate: number;
        unit: string;
        current_stock: number;
      }>(
        `SELECT id, name, selling_price, tax_rate, unit, current_stock 
         FROM items WHERE id = $1 AND business_id = $2`,
        [itemInput.item_id, businessId]
      );

      if (!item) {
        throw new Error(`Item ${itemInput.item_id} not found`);
      }

      const price = itemInput.price || item.selling_price;
      const quantity = itemInput.quantity;
      const lineTotal = price * quantity;
      const taxRate = item.tax_rate || 0;
      const taxAmount = (lineTotal * taxRate) / 100;
      
      // For simplicity, assume CGST/SGST (half each) for now
      // In production, you'd need to check business state and customer state
      const cgstAmount = taxAmount / 2;
      const sgstAmount = taxAmount / 2;

      subtotal += lineTotal;
      taxTotal += taxAmount;
      cgstTotal += cgstAmount;
      sgstTotal += sgstAmount;

      invoiceItems.push({
        ...item,
        quantity,
        price,
        taxRate,
        taxAmount,
        lineTotal,
        cgstAmount,
        sgstAmount
      });
    }

    const grandTotal = subtotal + taxTotal;
    const today = new Date().toISOString().split('T')[0];

    const defaultBranchRes = await client.query(
      `SELECT id FROM branches WHERE business_id = $1 AND is_default = true LIMIT 1`,
      [businessId]
    );
    const defaultBranchIdForInvoice = defaultBranchRes.rows[0]?.id as string | undefined;
    if (!defaultBranchIdForInvoice) {
      await client.query('ROLLBACK');
      client.release();
      throw new Error('No default branch configured for this business. Cannot create WhatsApp invoice.');
    }

    // Create invoice
    const invoiceRes = await client.query(
      `INSERT INTO invoices (
        business_id, branch_id, customer_id, invoice_number, invoice_date, due_date,
        status, payment_status, subtotal, discount_total, additional_charges, tax_total,
        round_off, grand_total, paid_amount, balance_amount,
        cgst_total, sgst_total, igst_total, document_type
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING id, invoice_number`,
      [
        businessId,
        defaultBranchIdForInvoice,
        customerId || null,
        invoiceNumber,
        today,
        today,
        'final', // Auto-finalize bot invoices
        'unpaid', // Cash sale is unpaid by default (can be updated later)
        subtotal,
        0, // discount_total
        0, // additional_charges
        taxTotal,
        0, // round_off
        grandTotal,
        0, // paid_amount (unpaid by default)
        grandTotal, // balance_amount
        cgstTotal,
        sgstTotal,
        igstTotal,
        'tax_invoice'
      ]
    );

    const invoice = invoiceRes.rows[0];

    // Get default warehouse if warehouse mode is enabled (reuse for all items)
    const { isWarehouseModeEnabled } = await import('./warehouse-mode');
    const warehouseModeEnabled = await isWarehouseModeEnabled(businessId);
    let defaultLocationId: string | null = null;
    
    if (warehouseModeEnabled) {
      const { getDefaultWarehouseForBranch } = await import('./warehouse-access');
      defaultLocationId = await getDefaultWarehouseForBranch(defaultBranchIdForInvoice);
      
      if (!defaultLocationId) {
        await client.query('ROLLBACK');
        client.release();
        throw new Error('Warehouse mode is enabled but no default warehouse found. Please configure a default warehouse for your default branch.');
      }
    }

    // Create invoice items and update stock
    for (const itemData of invoiceItems) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, item_name, quantity, unit_price, tax_rate,
          line_total, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
          location_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          invoice.id,
          itemData.id,
          itemData.name,
          itemData.quantity,
          itemData.price,
          itemData.taxRate,
          itemData.lineTotal,
          itemData.taxRate / 2, // CGST rate
          itemData.cgstAmount,
          itemData.taxRate / 2, // SGST rate
          itemData.sgstAmount,
          0, // IGST rate
          0, // IGST amount
          defaultLocationId
        ]
      );

      // Update stock
      const itemTypeRes = await client.query('SELECT item_type FROM items WHERE id = $1', [itemData.id]);
      const itemType = itemTypeRes.rows[0]?.item_type || 'goods';

      if (itemType === 'goods') {
        if (warehouseModeEnabled && defaultLocationId) {
          // Warehouse mode: update location_stock
          await client.query(
            `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (location_id, item_id)
             DO UPDATE SET
               current_stock_qty = location_stock.current_stock_qty - $3,
               last_updated = CURRENT_TIMESTAMP`,
            [defaultLocationId, itemData.id, itemData.quantity]
          );
        } else if (!warehouseModeEnabled) {
          const { adjustBranchItemStock, refreshItemGlobalStockFromBranches } = await import('./branch-stock');
          await adjustBranchItemStock(
            client,
            businessId,
            defaultBranchIdForInvoice,
            itemData.id,
            -itemData.quantity
          );
          await refreshItemGlobalStockFromBranches(client, businessId, itemData.id);
        }

        // Record stock movement (always include location_id when provided)
        await client.query(
          `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes)
           VALUES ($1, $2, $3, 'out', $4, 'invoice', $5, $6)`,
          [businessId, itemData.id, defaultLocationId, itemData.quantity, invoice.id, `Invoice ${invoiceNumber}`]
        );
      }
    }

    // Update next invoice number
    await client.query(
      `UPDATE businesses SET next_invoice_number = next_invoice_number + 1 WHERE id = $1`,
      [businessId]
    );

    // Update customer balance if customer exists
    if (customerId) {
      await client.query(
        `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [grandTotal, customerId]
      );
    }

    await client.query('COMMIT');

    return {
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Create sales order from WhatsApp bot
 * This is used for pending orders that require manual payment verification
 */
async function createSalesOrderFromWhatsApp(
  businessId: string,
  items: Array<{ item_id?: string; quantity: number; price: number; name: string }>,
  conversationId: string,
  customerId?: string,
  whatsappConvUUID?: string,
  shippingAddress?: string
): Promise<{ order_id: string; order_number: string; total_amount: number }> {
  const { queryOne, getPool } = await import('@/lib/db');
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get business settings for order number
    const business = await queryOne<{ next_sales_order_number: number; invoice_prefix: string }>(
      `SELECT COALESCE(next_sales_order_number, 1) as next_sales_order_number, invoice_prefix FROM businesses WHERE id = $1`,
      [businessId]
    );

    if (!business) {
      throw new Error('Business not found');
    }

    const orderNumber = `SO-${business.invoice_prefix || 'INV'}-${String(business.next_sales_order_number || 1).padStart(4, '0')}`;

    let subtotal = 0;
    const orderItems = [];

    // Process items
    for (const itemInput of items) {
      const lineTotal = itemInput.price * itemInput.quantity;
      subtotal += lineTotal;
      
      orderItems.push({
        ...itemInput,
        line_total: lineTotal
      });
    }

    const grandTotal = subtotal; // Simplified for now (no tax/discounts in SO)
    const today = new Date().toISOString().split('T')[0];

    // Create sales order with shipping address
    const orderRes = await client.query(
      `INSERT INTO sales_orders (
        business_id, customer_id, order_number, order_date,
        status, subtotal, grand_total, whatsapp_conversation_id,
        shipping_address, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, order_number`,
      [
        businessId,
        customerId || null,
        orderNumber,
        today,
        'draft',
        subtotal,
        grandTotal,
        whatsappConvUUID || null,
        shippingAddress || null
      ]
    );

    const order = orderRes.rows[0];

    // Create order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO sales_order_items (
          sales_order_id, item_id, item_name, qty, unit_price, line_total
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id,
          item.item_id || null,
          item.name,
          item.quantity,
          item.price,
          item.line_total
        ]
      );
    }

    // Update next order number
    await client.query(
      `UPDATE businesses SET next_sales_order_number = COALESCE(next_sales_order_number, 1) + 1 WHERE id = $1`,
      [businessId]
    );

    await client.query('COMMIT');

    return {
      order_id: order.id,
      order_number: order.order_number,
      total_amount: grandTotal
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('[CRM] Error creating sales order:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Cancel the latest draft order for a WhatsApp conversation (DB-backed).
 */
async function cancelLatestDraftOrderForConversation(params: {
  businessId: string;
  whatsappConversationUuid: string;
}): Promise<{ cancelled: boolean; orderNumber?: string }> {
  const { queryOne, query } = await import('@/lib/db');

  const latest = await queryOne<{ id: string; order_number: string }>(
    `SELECT id, order_number
     FROM sales_orders
     WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.businessId, params.whatsappConversationUuid]
  );

  if (!latest) return { cancelled: false };

  await query(
    `UPDATE sales_orders
     SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status = 'draft'`,
    [latest.id, params.businessId]
  );

  return { cancelled: true, orderNumber: latest.order_number };
}

/**
 * Update an existing draft sales order to match items (prices must be trusted DB prices).
 */
async function updateDraftSalesOrderFromWhatsApp(params: {
  businessId: string;
  orderId: string;
  items: Array<{ item_id?: string; quantity: number; price: number; name: string }>;
}): Promise<{ order_number: string; total_amount: number }> {
  const { getPool } = await import('@/lib/db');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = await client.query(
      `SELECT order_number
       FROM sales_orders
       WHERE id = $1 AND business_id = $2 AND status = 'draft'`,
      [params.orderId, params.businessId]
    );
    const orderNumber = order.rows?.[0]?.order_number as string | undefined;
    if (!orderNumber) throw new Error('Draft order not found for update');

    // Replace items entirely (simpler + avoids diff bugs)
    await client.query(
      `DELETE FROM sales_order_items WHERE sales_order_id = $1`,
      [params.orderId]
    );

    let subtotal = 0;
    for (const item of params.items) {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      if (qty <= 0 || price < 0) continue;
      const lineTotal = qty * price;
      subtotal += lineTotal;
      await client.query(
        `INSERT INTO sales_order_items (sales_order_id, item_id, item_name, qty, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [params.orderId, item.item_id || null, item.name, qty, price, lineTotal]
      );
    }

    const grandTotal = subtotal;
    await client.query(
      `UPDATE sales_orders
       SET subtotal = $1, grand_total = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND business_id = $4 AND status = 'draft'`,
      [subtotal, grandTotal, params.orderId, params.businessId]
    );

    await client.query('COMMIT');
    return { order_number: orderNumber, total_amount: grandTotal };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Check if this is the first message from a conversation
 * Note: conversationId here is the normalized phone number (conversation_id in whatsapp_conversations table)
 */
async function isFirstMessage(
  businessId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const { queryOne } = await import('@/lib/db');
    
    // Get the conversation record ID
    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations 
       WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, conversationId]
    );

    if (!conv) {
      return true; // New conversation = first message
    }
    
    // Count incoming messages (excluding the current one being processed)
    // This check happens BEFORE the current message is stored
    const count = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM whatsapp_conversation_messages
       WHERE business_id = $1 
       AND conversation_id = $2
       AND direction = 'incoming'`,
      [businessId, conv.id]
    );

    // If count is 0, this is the first message (current message hasn't been stored yet)
    return (count?.count || 0) === 0;
  } catch (error) {
    console.error('[CRM] Error checking first message:', error);
    return false;
  }
}

/**
 * Check if rule conditions are met
 */
async function checkRuleConditions(
  businessId: string,
  conversationId: string,
  rule: any,
  isGroup: boolean,
  currentState?: { state: string; context: any },
  messageType?: string
): Promise<boolean> {
  const conditions = rule.trigger_conditions;
  if (!conditions || typeof conditions !== 'object') {
    return true; // No conditions = always match
  }

  try {
    const { queryRows, queryOne } = await import('@/lib/db');

    // Check required labels
    if (conditions.required_label_ids && Array.isArray(conditions.required_label_ids) && conditions.required_label_ids.length > 0) {
      const conv = await queryOne(
        `SELECT id FROM whatsapp_conversations 
         WHERE business_id = $1 AND conversation_id = $2`,
        [businessId, conversationId]
      );

      if (!conv) return false;

      const labelCount = await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM whatsapp_conversation_label_assignments
         WHERE conversation_id = $1 
         AND label_id = ANY($2::uuid[])`,
        [conv.id, conditions.required_label_ids]
      );

      if ((labelCount?.count || 0) < conditions.required_label_ids.length) {
        return false; // Not all required labels are present
      }
    }

    // Check excluded labels
    if (conditions.excluded_label_ids && Array.isArray(conditions.excluded_label_ids) && conditions.excluded_label_ids.length > 0) {
      const conv = await queryOne(
        `SELECT id FROM whatsapp_conversations 
         WHERE business_id = $1 AND conversation_id = $2`,
        [businessId, conversationId]
      );

      if (conv) {
        const labelCount = await queryOne<{ count: number }>(
          `SELECT COUNT(*) as count
           FROM whatsapp_conversation_label_assignments
           WHERE conversation_id = $1 
           AND label_id = ANY($2::uuid[])`,
          [conv.id, conditions.excluded_label_ids]
        );

        if ((labelCount?.count || 0) > 0) {
          return false; // Has excluded label
        }
      }
    }

    // Check minimum inactivity
    if (conditions.min_inactivity_minutes && typeof conditions.min_inactivity_minutes === 'number') {
      const state = await queryOne<{ last_interaction_at: Date }>(
        `SELECT last_interaction_at 
         FROM whatsapp_conversation_states 
         WHERE business_id = $1 AND conversation_id = $2`,
        [businessId, conversationId]
      );

      if (state?.last_interaction_at) {
        const minutesSinceLastMessage = (Date.now() - new Date(state.last_interaction_at).getTime()) / (1000 * 60);
        if (minutesSinceLastMessage < conditions.min_inactivity_minutes) {
          return false; // Not inactive enough
        }
      } else {
        return false; // No previous interaction = can't check inactivity
      }
    }

    // Check sender types
    if (conditions.sender_types && Array.isArray(conditions.sender_types)) {
      const expectedType = isGroup ? 'group' : 'individual';
      if (!conditions.sender_types.includes(expectedType)) {
        return false;
      }
    }

    // Check conversation state
    if (conditions.conversation_state) {
      const state = currentState?.state || 'idle';
      if (state !== conditions.conversation_state) {
        return false;
      }
    }

    // Check message type
    if (conditions.message_type && messageType) {
      if (messageType !== conditions.message_type) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('[CRM] Error checking rule conditions:', error);
    return false;
  }
}

/**
 * Execute auto actions for a matched rule
 */
async function executeAutoActions(
  businessId: string,
  conversationId: string,
  rule: any,
  messageText: string
): Promise<void> {
  const actions = rule.auto_actions;
  if (!actions || typeof actions !== 'object') {
    return; // No actions to execute
  }

  try {
    const { queryOne, query } = await import('@/lib/db');

    // Get conversation record
    const conv = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversations 
       WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, conversationId]
    );

    if (!conv) return;

    // Add labels
    if (actions.add_labels && Array.isArray(actions.add_labels)) {
      for (const labelId of actions.add_labels) {
        await query(
          `INSERT INTO whatsapp_conversation_label_assignments (conversation_id, label_id)
           VALUES ($1, $2)
           ON CONFLICT (conversation_id, label_id) DO NOTHING`,
          [conv.id, labelId]
        );
      }
    }

    // Remove labels
    if (actions.remove_labels && Array.isArray(actions.remove_labels)) {
      await query(
        `DELETE FROM whatsapp_conversation_label_assignments
         WHERE conversation_id = $1 AND label_id = ANY($2::uuid[])`,
        [conv.id, actions.remove_labels]
      );
    }

    // Create lead (placeholder - implement your CRM logic here)
    if (actions.create_lead === true) {
      // TODO: Implement lead creation logic
      console.log('[CRM] Auto action: Create lead for conversation', conversationId);
    }

    // Assign to user
    if (actions.assign_to_user_id) {
      // TODO: Implement user assignment logic
      console.log('[CRM] Auto action: Assign conversation to user', actions.assign_to_user_id);
    }

    // Save context variables
    if (actions.save_context && typeof actions.save_context === 'object') {
      const currentState = await getConversationState(businessId, conversationId);
      const context = currentState?.context || {};
      
      for (const [key, value] of Object.entries(actions.save_context)) {
        if (typeof value === 'string') {
          // Simple placeholder replacement (can be enhanced)
          context[key] = value.replace('{{message}}', messageText);
        } else {
          context[key] = value;
        }
      }

      await updateConversationState(businessId, conversationId, currentState?.state || 'idle', context);
    }
  } catch (error) {
    console.error('[CRM] Error executing auto actions:', error);
  }
}

/**
 * Replace variables in message text with customer data
 */
async function replaceMessageVariables(
  businessId: string,
  messageText: string,
  customerId?: string | null,
  normalizedPhone?: string
): Promise<string> {
  if (!messageText) return messageText;
  
  // Default values
  let name = 'there';
  let phone = normalizedPhone || '';
  let email = '';
  let lastOrder = '';
  let balance = '0';
  
  // Get customer data if customerId exists
  if (customerId) {
    try {
      const customer = await queryOne<{
        name?: string;
        phone?: string;
        email?: string;
      }>(
        `SELECT name, phone, email FROM customers WHERE id = $1 AND business_id = $2`,
        [customerId, businessId]
      );
      
      if (customer) {
        name = customer.name || normalizedPhone || 'there';
        phone = customer.phone || normalizedPhone || '';
        email = customer.email || '';
        
        // Get last order
        const lastInvoice = await queryOne<{ invoice_number?: string }>(
          `SELECT invoice_number FROM invoices 
           WHERE customer_id = $1 AND business_id = $2 
           ORDER BY created_at DESC LIMIT 1`,
          [customerId, businessId]
        );
        if (lastInvoice?.invoice_number) {
          lastOrder = lastInvoice.invoice_number;
        }
        
        // Get balance (sum of balance_amount from all invoices)
        const balanceResult = await queryOne<{ total?: string }>(
          `SELECT COALESCE(SUM(balance_amount), 0) as total 
           FROM invoices 
           WHERE customer_id = $1 AND business_id = $2 AND status != 'cancelled'`,
          [customerId, businessId]
        );
        if (balanceResult?.total) {
          balance = parseFloat(balanceResult.total).toFixed(2);
        }
      }
    } catch (error) {
      console.error('[CRM] Error fetching customer data for variable replacement:', error);
    }
  } else if (normalizedPhone) {
    // If no customerId, use phone number as name fallback
    name = normalizedPhone;
  }
  
  // Replace variables
  let result = messageText;
  result = result.replace(/\{\{name\}\}/g, name);
  result = result.replace(/\{\{phone\}\}/g, phone);
  result = result.replace(/\{\{email\}\}/g, email);
  result = result.replace(/\{\{last_order\}\}/g, lastOrder);
  result = result.replace(/\{\{balance\}\}/g, balance);
  
  return result;
}

/**
 * Evaluate bot rules and find matching rule
 */
async function evaluateBotRules(
  businessId: string,
  messageText: string,
  isGroup: boolean,
  conversationId: string,
  messageType: string = 'text',
  currentState?: { state: string; context: any }
): Promise<any | null> {
  try {
    const { queryRows } = await import('@/lib/db');
    
    console.log('[CRM] 🔍 evaluateBotRules called:', {
      businessId,
      messageText: messageText.substring(0, 50),
      isGroup,
      conversationId,
      messageType
    });
    
    // Get active bot rules ordered by priority (highest first)
    // Include all new columns from migration 029
    const rules = await queryRows(
      `SELECT id, name, trigger_type, trigger_value, priority,
              response_type, response_message, response_options, next_rule_id,
              only_for_individuals, trigger_conditions, auto_actions,
              fallback_message, expected_input_type, context_variables,
              response_media_url, response_media_type, category, end_flow, delay_seconds
       FROM whatsapp_bot_rules
       WHERE business_id = $1 AND is_active = true
       ORDER BY priority DESC`,
      [businessId]
    );

    console.log('[CRM] 📋 Found rules:', rules.length);

    if (rules.length === 0) {
      console.log('[CRM] ⚠️ No active bot rules found');
      return null; // No rules configured
    }

    const messageLower = messageText.toLowerCase().trim();
    const messageOriginal = messageText.trim();

    // Check if this is a first message
    const firstMessage = await isFirstMessage(businessId, conversationId);

    for (const rule of rules) {
      console.log('[CRM] 🔎 Evaluating rule:', {
        name: rule.name,
        trigger_type: rule.trigger_type,
        trigger_value: rule.trigger_value,
        priority: rule.priority,
        only_for_individuals: rule.only_for_individuals
      });
      // Skip if rule is only for individuals and message is from group
      if (rule.only_for_individuals && isGroup) {
        continue;
      }

      // Check conditions first
      const conditionsMet = await checkRuleConditions(
        businessId,
        conversationId,
        rule,
        isGroup,
        currentState,
        messageType
      );

      if (!conditionsMet) {
        console.log('[CRM] ❌ Conditions not met for rule:', rule.name);
        continue; // Conditions not met, skip this rule
      }
      
      console.log('[CRM] ✅ Conditions met for rule:', rule.name);

      // Check trigger type
      let matches = false;

      switch (rule.trigger_type) {
        case 'all':
          matches = true;
          break;

        case 'exact_match':
          matches = messageOriginal.toLowerCase() === rule.trigger_value.toLowerCase();
          break;

        case 'keyword':
          // Handle comma-separated keywords (e.g., "Hi, Hello" should match "Hi" OR "Hello")
          if (rule.trigger_value) {
            const keywords = rule.trigger_value.split(',').map((k: string) => k.trim().toLowerCase());
            matches = keywords.some((keyword: string) => messageLower.includes(keyword));
            console.log('[CRM] 🔍 Keyword matching:', {
              ruleName: rule.name,
              triggerValue: rule.trigger_value,
              parsedKeywords: keywords,
              messageLower,
              matches
            });
          } else {
            matches = false;
          }
          break;

        case 'starts_with':
          matches = messageLower.startsWith(rule.trigger_value.toLowerCase());
          break;

        case 'ends_with':
          matches = messageLower.endsWith(rule.trigger_value.toLowerCase());
          break;

        case 'match_any_keyword':
          if (rule.trigger_value) {
            const keywords = rule.trigger_value.split(',').map((k: string) => k.trim().toLowerCase());
            matches = keywords.some((keyword: string) => messageLower.includes(keyword));
          }
          break;

        case 'match_all_keywords':
          if (rule.trigger_value) {
            const keywords = rule.trigger_value.split(',').map((k: string) => k.trim().toLowerCase());
            matches = keywords.every((keyword: string) => messageLower.includes(keyword));
          }
          break;

        case 'regex':
          try {
            const regex = new RegExp(rule.trigger_value, 'i');
            matches = regex.test(messageOriginal);
          } catch (e) {
            console.error('[CRM] Invalid regex in bot rule:', rule.name, e);
            continue;
          }
          break;

        case 'first_message':
          matches = firstMessage;
          break;

        case 'message_type':
          matches = messageType === rule.trigger_value;
          break;

        default:
          console.warn('[CRM] Unknown trigger type:', rule.trigger_type);
          continue;
      }

      if (matches) {
        console.log('[CRM] ✅ Rule matched!', {
          ruleName: rule.name,
          ruleId: rule.id,
          hasResponse: !!rule.response_message
        });
        
        // Execute auto actions
        await executeAutoActions(businessId, conversationId, rule, messageText);
        
        // Return the matched rule
        return rule;
      } else {
        console.log('[CRM] ❌ Rule did not match:', rule.name);
      }
    }

    console.log('[CRM] ⚠️ No rules matched for message');
    return null;
  } catch (error) {
    console.error('[CRM] Error evaluating bot rules:', error);
    return null;
  }
}

/**
 * Get next rule based on user selection (for button/list responses)
 */
async function getNextRuleFromChain(
  ruleId: string,
  selectedOptionId: string,
  businessId: string
): Promise<any | null> {
  try {
    const { queryOne } = await import('@/lib/db');
    
    const chain = await queryOne(
      `SELECT next_rule_id 
       FROM whatsapp_bot_rule_chains 
       WHERE rule_id = $1 AND option_id = $2`,
      [ruleId, selectedOptionId]
    );

    if (!chain?.next_rule_id) {
      return null;
    }

    const nextRule = await queryOne(
      `SELECT id, name, trigger_type, trigger_value, priority,
              response_type, response_message, response_options, next_rule_id,
              only_for_individuals
       FROM whatsapp_bot_rules
       WHERE id = $1 AND business_id = $2 AND is_active = true`,
      [chain.next_rule_id, businessId]
    );

    return nextRule || null;
  } catch (error) {
    console.error('[CRM] Error getting next rule from chain:', error);
    return null;
  }
}

/**
 * Get global WhatsApp bot typing settings for a business
 */
async function getBotTypingSettings(businessId: string): Promise<{
  typingEnabled: boolean;
  delaySeconds: number;
}> {
  try {
    const settings = await queryOne(
      `SELECT whatsapp_bot_typing_enabled, whatsapp_bot_typing_delay_seconds 
       FROM business_settings 
       WHERE business_id = $1`,
      [businessId]
    );

    return {
      typingEnabled: settings?.whatsapp_bot_typing_enabled || false,
      delaySeconds: settings?.whatsapp_bot_typing_delay_seconds || 3
    };
  } catch (error: any) {
    // If columns don't exist yet, return defaults
    console.warn('[CRM] Error fetching bot typing settings (may need migration):', error.message);
    return {
      typingEnabled: false,
      delaySeconds: 3
    };
  }
}

/**
 * Process incoming message and generate response
 */
export async function processIncomingMessage(
  businessId: string,
  fromJid: string, // Full JID
  toNumber: string,
  messageText: string,
  messageId: string,
  messageType: string = 'text',
  mediaUrl?: string,
  isGroup: boolean = false,
  groupName?: string,
  groupJid?: string,
  whatsappDisplayName?: string, // WhatsApp display name (pushName) - may be from phone address book or profile
  sourceTimestampSec?: number | null,
  originalWaTimestampSec?: number | null
): Promise<{ 
  response?: string; 
  shouldStore?: boolean;
  responseType?: string;
  buttons?: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }>;
  footer?: string;
  mediaUrl?: string;
  delaySeconds?: number;
  enableTyping?: boolean;
}> {
  const mediaUrlInfo =
    typeof mediaUrl === 'string' && mediaUrl.length > 0
      ? mediaUrl.startsWith('data:')
        ? { kind: 'data', bytes: mediaUrl.length }
        : { kind: 'url', bytes: mediaUrl.length }
      : null;

  console.log('[CRM] 🔄 processIncomingMessage called:', {
    businessId,
    fromJid,
    toNumber,
    messageText: messageText.substring(0, 50),
    messageId,
    messageType,
    mediaUrl: mediaUrlInfo,
    isGroup,
    groupName
  });
  
  const messageLower = messageText.toLowerCase().trim();

  // Fetch global bot typing settings (used for all bot responses)
  const botTypingSettings = await getBotTypingSettings(businessId);

  try {
    // Skip bot/auto-reply if we already processed this WhatsApp message id (retries / duplicate events).
    const existingMsg = await queryOne<{ id: string }>(
      `SELECT id FROM whatsapp_conversation_messages WHERE message_id = $1 AND business_id = $2 LIMIT 1`,
      [messageId, businessId]
    );

    // Store the incoming message first
    const { conversationId, customerId } = await storeIncomingMessage(
      businessId,
      fromJid,
      toNumber,
      messageText,
      messageId,
      messageType, // Use passed message type (image, video, document, etc.)
      mediaUrl, // Use passed media URL if available
      isGroup,
      groupName,
      groupJid,
      whatsappDisplayName, // Pass WhatsApp display name
      sourceTimestampSec,
      originalWaTimestampSec
    );

    if (existingMsg) {
      console.log('[CRM] Duplicate message_id — stored/updated only, skipping bot reply:', messageId);
      return { shouldStore: true };
    }
    
    // Extract normalized phone for state / bot rules (groups may use participant or 'unknown')
    let normalizedFrom = extractPhoneFromJid(fromJid);
    if (!normalizedFrom) {
      if (isGroup) {
        normalizedFrom = 'unknown';
      } else {
        console.warn('[CRM] Could not extract phone number from JID:', fromJid);
        return { shouldStore: false };
      }
    }

    // Get current conversation state (individual chats only)
    const currentState = await getConversationState(businessId, normalizedFrom);
    const convState: ConversationState = (currentState?.state as ConversationState) || 'idle';
    const convContext = currentState?.context || {};
    
    console.log('[CRM] 🔍 Conversation State Check:', {
      hasState: !!currentState,
      state: convState,
      context: convContext,
      normalizedFrom,
      isGroup,
      messageType,
      messageTextTrimmed: !!messageText.trim(),
      willCheckAI: !isGroup && messageType === 'text' && messageText.trim() // AI will check even in waiting_payment (payment confirmations handled first)
    });

    // Partial settlement notice (once); then full paid confirmation (webhook-first)
    if (!isGroup && convState === 'waiting_payment') {
      const partialNotice = await maybeNotifyPartialPaymentReceived({
        businessId,
        conversationId,
        normalizedFrom
      });
      if (partialNotice) return partialNotice;

      const paidImmediate = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
        businessId,
        whatsappConversationUuid: conversationId,
        normalizedFrom
      });
      if (paidImmediate) return paidImmediate;
    }

    // Check if we're in a chained conversation flow
    // If state contains a waiting_for_option from a previous rule, try to chain
    if (convState === 'waiting_for_option' && convContext?.waiting_rule_id) {
      const nextRule = await getNextRuleFromChain(
        convContext.waiting_rule_id,
        messageLower, // User's selection (could be option ID or text)
        businessId
      );

      if (nextRule) {
        // Update state to the next rule's state
        await updateConversationState(businessId, normalizedFrom, 'waiting_for_option', {
          waiting_rule_id: nextRule.id
        });

        // Return response from next rule
        return {
          response: nextRule.response_message,
          shouldStore: true
        };
      }
    }

    // Evaluate bot rules first (before hardcoded commands)
    const matchedRule = await evaluateBotRules(
      businessId,
      messageText,
      isGroup,
      normalizedFrom, // conversationId (normalized phone number)
      messageType, // Pass actual message type
      currentState || undefined
    );
    
    console.log('[CRM] 📋 Bot rules evaluation complete:', {
      hasMatchedRule: !!matchedRule,
      matchedRuleName: matchedRule?.name || 'none',
      willContinueToAI: !matchedRule && !isGroup && messageType === 'text' && messageText.trim() // AI will check even in waiting_payment (payment confirmations handled first)
    });

    if (matchedRule) {
      // If rule has next_rule_id or response_options, set state to wait for user input
      if (matchedRule.response_options || matchedRule.next_rule_id) {
        await updateConversationState(businessId, normalizedFrom, 'waiting_for_option', {
          waiting_rule_id: matchedRule.id
        });
      } else if (matchedRule.end_flow) {
        // Clear state if rule ends the flow
        await updateConversationState(businessId, normalizedFrom, 'idle', {});
      } else {
        // Keep current state or set to idle
        await updateConversationState(businessId, normalizedFrom, 'idle', {});
      }

      // Handle different response types (image, video, document, buttons, list)
      console.log('[CRM] 📤 Bot rule matched, processing response:', {
        ruleName: matchedRule.name,
        responseType: matchedRule.response_type,
        hasResponseMessage: !!matchedRule.response_message,
        responseMessage: matchedRule.response_message ? matchedRule.response_message.substring(0, 100) : 'NO MESSAGE',
        hasResponseOptions: !!matchedRule.response_options,
        responseOptionsCount: matchedRule.response_options?.length || 0,
        responseOptions: matchedRule.response_options
      });
      
      if (!matchedRule.response_message && !matchedRule.fallback_message) {
        console.warn('[CRM] ⚠️ Rule matched but has no response_message or fallback_message:', matchedRule.name);
        return {
          response: undefined,
          shouldStore: true
        };
      }
      
      // Replace variables in response message (use customerId from storeIncomingMessage)
      const responseMessage = matchedRule.response_message || matchedRule.fallback_message;
      let processedResponse: string;
      try {
        processedResponse = await replaceMessageVariables(
          businessId,
          responseMessage,
          customerId,
          normalizedFrom
        );
      } catch (error) {
        console.error('[CRM] Error replacing variables in response message:', error);
        // Fall back to original message if variable replacement fails
        processedResponse = responseMessage;
      }
      
      // Convert response_options to button format if response_type is 'button'
      let buttons: Array<{ id: string; title: string; type?: 'quick_reply' | 'call' | 'url'; phone?: string; url?: string }> | undefined;
      let footer: string | undefined;
      
      if (matchedRule.response_type === 'button' && matchedRule.response_options && Array.isArray(matchedRule.response_options) && matchedRule.response_options.length > 0) {
        try {
          // response_options is already in the button format (id, title, type, phone, url)
          const allButtons = matchedRule.response_options as any;
          
          // Replace variables in button titles and process buttons
          const processedButtons = await Promise.all(
            allButtons
              .filter((b: any) => b.id !== '__footer__') // Filter out footer
              .map(async (button: any) => {
                try {
                  const processedTitle = await replaceMessageVariables(
                    businessId,
                    button.title || '',
                    customerId,
                    normalizedFrom
                  );
                  
                  const processedButton: any = {
                    ...button,
                    title: processedTitle
                  };
                  
                  // Replace variables in phone number if it's a call button
                  if (button.type === 'call' && button.phone) {
                    try {
                      processedButton.phone = await replaceMessageVariables(
                        businessId,
                        button.phone,
                        customerId,
                        normalizedFrom
                      );
                    } catch (error) {
                      console.error('[CRM] Error replacing variables in phone:', error);
                      // Keep original phone if replacement fails
                    }
                  }
                  
                  // Replace variables in URL if it's a url button
                  if (button.type === 'url' && button.url) {
                    try {
                      processedButton.url = await replaceMessageVariables(
                        businessId,
                        button.url,
                        customerId,
                        normalizedFrom
                      );
                    } catch (error) {
                      console.error('[CRM] Error replacing variables in URL:', error);
                      // Keep original URL if replacement fails
                    }
                  }
                  
                  return processedButton;
                } catch (error) {
                  console.error('[CRM] Error processing button:', error);
                  // Return original button if processing fails
                  return button;
                }
              })
          );
          
          if (processedButtons.length > 0) {
            buttons = processedButtons;
          }
          
          // Extract and process footer if present
          const footerOption = allButtons.find((b: any) => b.id === '__footer__');
          if (footerOption) {
            try {
              footer = await replaceMessageVariables(
                businessId,
                footerOption.title,
                customerId,
                normalizedFrom
              );
            } catch (error) {
              console.error('[CRM] Error replacing variables in footer:', error);
              footer = footerOption.title; // Keep original footer if replacement fails
            }
          }
          
          console.log('[CRM] 🔘 Button message processed:', {
            buttonsCount: buttons?.length || 0,
            buttons: buttons,
            footer: footer
          });
        } catch (error) {
          console.error('[CRM] Error processing button message:', error);
          // Continue without buttons if processing fails - message will still be sent
        }
      } else {
        console.log('[CRM] ⚠️ Button type rule but no response_options found or empty');
      }
      
      // Log automation event for bot rule response (plain text, not just buttons)
      // This ensures all bot rule responses are tracked as "Bot Handled" in dashboard
      // Note: Button messages will also create events in storeOutgoingMessage, but we log here too for consistency
      try {
        await logAutomationEvent(
          conversationId,
          businessId,
          'bot_message',
          {
            message_type: matchedRule.response_type || 'text',
            source: 'bot_rule',
            rule_name: matchedRule.name,
            rule_id: matchedRule.id,
            has_buttons: !!(buttons && buttons.length > 0),
            button_count: buttons?.length || 0,
            response_preview: processedResponse.substring(0, 100)
          }
        );
        console.log('[CRM] ✅ Logged bot_message automation event for bot rule response:', matchedRule.name);
      } catch (err) {
        console.error('[CRM] Error logging automation event for bot rule response:', err);
        // Non-critical: continue even if event logging fails
      }
      
      return {
        response: processedResponse,
        shouldStore: true,
        responseType: matchedRule.response_type,
        buttons: buttons && buttons.length > 0 ? buttons : undefined,
        footer: footer,
        mediaUrl: matchedRule.response_media_url,
        delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
        // Use global settings instead of per-rule delay_seconds
      };
    }

    // Handle payment confirmations BEFORE AI tries to respond (individual chats only)
    // This prevents AI from generating responses to payment confirmations
    if (!isGroup && messageType === 'text' && convState === 'waiting_payment') {
      // Enhanced regex to match WhatsApp payment notification format
      // Matches: "NAME paid ₹AMOUNT to BUSINESS via PROVIDER"
      // Example: "REJA ULLAH paid ₹546 to NANDINI MILK PARLOUR via Navi UPI"
      // Also matches: "I paid", "paid ₹546", etc.
      const paymentNotificationMatch = messageText.match(/(?:([A-Z][A-Z\s]+?)\s+)?paid\s+₹?\s*(\d+(?:\.\d{2})?)\s+to\s+([^\n]+?)(?:\s+via\s+([^\n]+?))?(?:\n|\.|$)/i);
      
      const paymentConfirmPatterns = [
        /\b(i\s+paid|payment\s+done|payment\s+completed|paid|payment\s+sent|transfer\s+done|i\s+transferred)\b/i,
        /\b(paid\s+₹?\s*\d+|₹?\s*\d+\s+paid|sent\s+₹?\s*\d+|transferred\s+₹?\s*\d+)\b/i,
      ];

      const isPaymentConfirmation = paymentConfirmPatterns.some(pattern => pattern.test(messageText)) || !!paymentNotificationMatch;
      
      console.log('[CRM] 💳 Payment state check:', {
        convState: 'waiting_payment',
        messageText: messageText.substring(0, 50),
        isPaymentConfirmation,
        hasPaymentNotification: !!paymentNotificationMatch
      });
      
      if (isPaymentConfirmation || paymentNotificationMatch) {
        console.log('[CRM] 💳 Payment confirmation detected (BEFORE AI):', {
          messageText: messageText.substring(0, 100),
          hasPaymentNotification: !!paymentNotificationMatch
        });

        try {
          // Get the latest order for this conversation
          const latestOrder = await queryOne<any>(
            `SELECT id, order_number, grand_total, payment_status
             FROM sales_orders 
             WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
             ORDER BY created_at DESC LIMIT 1`,
            [businessId, conversationId]
          );

          if (latestOrder) {
            if (latestOrder.payment_status === 'paid') {
              const paidByWebhook = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
                businessId,
                whatsappConversationUuid: conversationId,
                normalizedFrom
              });
              if (paidByWebhook) return paidByWebhook;
            }

            const expectedAmount = parseFloat(latestOrder.grand_total);
            
            // Extract actual paid amount from message
            let actualAmount: number | null = null;
            if (paymentNotificationMatch) {
              // paymentNotificationMatch[1] = sender name (optional)
              // paymentNotificationMatch[2] = amount
              actualAmount = parseFloat(paymentNotificationMatch[2] || paymentNotificationMatch[1]);
            } else {
              // Try to extract amount from text (fallback for "I paid ₹546" format)
              const amountMatch = messageText.match(/₹?\s*(\d+(?:\.\d{2})?)/);
              if (amountMatch) {
                actualAmount = parseFloat(amountMatch[1]);
              }
            }

            // If we couldn't extract amount, ask for screenshot
            if (!actualAmount) {
              return {
                response: "Thank you for confirming the payment! Please share a screenshot of the payment confirmation so I can verify the amount and process your order.",
                shouldStore: true
              };
            }

            // Check for amount discrepancy
            const amountDifference = Math.abs(expectedAmount - actualAmount);
            const amountMatch = amountDifference < 1; // Allow 1 rupee difference for rounding

            if (!amountMatch) {
              // Amount mismatch - flag for manual review
              console.warn('[CRM] ⚠️ Payment amount mismatch:', {
                expected: expectedAmount,
                received: actualAmount,
                difference: amountDifference,
                orderId: latestOrder.id
              });

              await query(
                `UPDATE sales_orders 
                 SET ocr_status = 'requires_review',
                     ocr_data = $1,
                     notes = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3
                   AND (payment_status IS NULL OR payment_status IS DISTINCT FROM 'paid')`,
                [
                  JSON.stringify({
                    payment_confirmed: true,
                    expected_amount: expectedAmount,
                    received_amount: actualAmount,
                    difference: amountDifference,
                    payment_message: messageText.substring(0, 500),
                    verified_via: 'text_message',
                    verification_source: 'text_message'
                  }),
                  `Payment amount mismatch: Expected ₹${expectedAmount}, Received ₹${actualAmount}. Manual review required.`,
                  latestOrder.id
                ]
              );

              await clearConversationState(businessId, normalizedFrom);

              return {
                response: `I've received your payment of ₹${actualAmount}. However, there's a difference from the expected amount of ₹${expectedAmount}. Our team will verify this and get back to you shortly. Thank you!`,
                shouldStore: true
              };
            }

            // Amount matches - auto-verify and confirm order (skip if PSP already marked paid — webhook wins)
            console.log('[CRM] ✅ Payment amount verified:', {
              expected: expectedAmount,
              received: actualAmount,
              orderId: latestOrder.id
            });

            const itemsList = await formatDraftOrderConfirmationLines(latestOrder.id);
                const ocrPayload = JSON.stringify({
                  payment_confirmed: true,
                  expected_amount: expectedAmount,
                  received_amount: actualAmount,
                  payment_message: messageText.substring(0, 500),
                  verified_via: 'text_message',
                  auto_verified: true,
                  verification_source: 'text_message'
                });

            const textVerified = await queryOne<{ id: string }>(
              `UPDATE sales_orders 
               SET ocr_status = 'verified',
                   ocr_data = $1::jsonb,
                   notes = 'Payment verified via text confirmation',
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2
                 AND status = 'draft'
                 AND (payment_status IS NULL OR payment_status IS DISTINCT FROM 'paid')
               RETURNING id`,
              [ocrPayload, latestOrder.id]
            );

            if (!textVerified) {
              const paidByWebhook = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
                businessId,
                whatsappConversationUuid: conversationId,
                normalizedFrom
              });
              if (paidByWebhook) return paidByWebhook;
              await clearConversationState(businessId, normalizedFrom);
              return {
                response:
                  'Thanks — your payment is already recorded for this order. If you need anything else, just ask.',
                shouldStore: true
              };
            }

            await clearConversationState(businessId, normalizedFrom);

            return {
              response: whatsAppOrderConfirmedMessage(itemsList, expectedAmount),
              shouldStore: true
            };
          }
        } catch (error) {
          console.error('[CRM] Error processing payment confirmation:', error);
        }
      } else {
        // In waiting_payment state but message is not a payment confirmation
        // Customer might be asking something else - clear the state and let AI respond
        console.log('[CRM] 💬 Customer sent non-payment message while in waiting_payment state. Message: "' + messageText.substring(0, 50) + '". Clearing state to allow AI response.');
        await clearConversationState(businessId, normalizedFrom);
        // Update convState variable for the rest of the function
        // Note: We can't reassign a const, but the state is cleared in DB, so AI will proceed
        // Continue to AI chatbot below (don't return, let it fall through)
      }
    }

    // AI Sales Agent - Try to generate response if no manual rule matched (individual chats only)
    // Note: We allow AI to respond even in waiting_payment state, but payment confirmations are handled first above
    if (!isGroup && messageType === 'text' && messageText.trim()) {
      console.log('[CRM] 🔍 Pre-AI Check:', {
        isGroup,
        messageType,
        hasMessageText: !!messageText.trim(),
        convState,
        condition1: !isGroup,
        condition2: messageType === 'text',
        condition3: !!messageText.trim(),
        condition4: convState !== 'waiting_payment',
        allConditionsMet: true,
        willProceedToAI: true
      });
      
      try {
        // Check AI config for Dev/Prod mode and allowed phones
        const aiConfig = await queryOne<any>(
          `SELECT mode, dev_allowed_phones, chatbot_enabled
           FROM ai_provider_config WHERE business_id = $1`,
          [businessId]
        );

        console.log('[CRM] 🔍 AI Config Check:', {
          hasConfig: !!aiConfig,
          chatbot_enabled: aiConfig?.chatbot_enabled,
          mode: aiConfig?.mode,
          dev_allowed_phones: aiConfig?.dev_allowed_phones,
          normalizedFrom,
          businessId
        });

        // Skip AI if chatbot is disabled (default to enabled if not set)
        // chatbot_enabled defaults to true in the database, but check explicitly
        const isChatbotEnabled = aiConfig?.chatbot_enabled !== false; // Default to true if null/undefined
        
        if (!aiConfig) {
          console.log('[CRM] ⚠️ No AI config found, skipping AI response. Please configure AI provider in settings.');
          return { shouldStore: true };
        }
        
        if (!isChatbotEnabled) {
          console.log('[CRM] 🤖 AI chatbot is disabled, skipping...', {
            hasConfig: !!aiConfig,
            chatbot_enabled: aiConfig.chatbot_enabled
          });
          return { shouldStore: true };
        }
        
        console.log('[CRM] ✅ AI chatbot is enabled, proceeding...');

        // Check Dev mode restrictions
        if (aiConfig?.mode === 'dev') {
          console.log('[CRM] 🔍 Dev Mode Check:', {
            mode: aiConfig.mode,
            dev_allowed_phones_raw: aiConfig.dev_allowed_phones,
            dev_allowed_phones_type: typeof aiConfig.dev_allowed_phones
          });
          
          // Handle both JSONB array format (from DB) and string format (edge case)
          let allowedPhones: string[] = [];
          if (aiConfig.dev_allowed_phones) {
            if (typeof aiConfig.dev_allowed_phones === 'string') {
              try {
                allowedPhones = JSON.parse(aiConfig.dev_allowed_phones);
                console.log('[CRM] ✅ Parsed dev_allowed_phones from string:', allowedPhones);
              } catch (e) {
                console.warn('[CRM] Failed to parse dev_allowed_phones as JSON:', e);
                allowedPhones = [];
              }
            } else if (Array.isArray(aiConfig.dev_allowed_phones)) {
              allowedPhones = aiConfig.dev_allowed_phones;
              console.log('[CRM] ✅ dev_allowed_phones is already array:', allowedPhones);
            } else {
              console.warn('[CRM] ⚠️ dev_allowed_phones is unexpected type:', typeof aiConfig.dev_allowed_phones, aiConfig.dev_allowed_phones);
            }
          } else {
            console.log('[CRM] ⚠️ dev_allowed_phones is null/undefined');
          }
          
          // Normalize all allowed phone numbers (remove non-digits)
          const normalizedAllowedPhones = allowedPhones
            .filter((p: string) => p && typeof p === 'string')
            .map((p: string) => p.replace(/[^0-9]/g, ''))
            .filter((p: string) => p.length > 0);
          
          // Normalize incoming phone number
          const normalizedPhone = normalizedFrom.replace(/[^0-9]/g, '');
          
          console.log('[CRM] 🔍 Phone Number Comparison:', {
            normalizedFrom,
            normalizedPhone,
            normalizedAllowedPhones,
            isIncluded: normalizedAllowedPhones.includes(normalizedPhone)
          });
          
          if (normalizedAllowedPhones.length === 0) {
            console.log('[CRM] 🤖 Dev mode: No allowed phones configured — message stored, no auto-reply sent');
            return { shouldStore: true };
          }

          if (!normalizedAllowedPhones.includes(normalizedPhone)) {
            console.log('[CRM] 🤖 Dev mode: Phone not in allowed list — message stored, no auto-reply sent:', {
              phone: normalizedPhone,
              allowedPhones: normalizedAllowedPhones,
            });
            return { shouldStore: true };
          }
          
          console.log('[CRM] 🤖 Dev mode: Phone is allowed, proceeding with AI response');
        } else {
          // Prod mode or mode is null (defaults to prod per migration)
          console.log('[CRM] 🤖 Prod mode: AI will respond to all numbers', {
            mode: aiConfig?.mode || 'null (defaulting to prod)'
          });
        }

        console.log('[CRM] 🤖 No manual rule matched, trying AI Sales Agent...', {
          businessId,
          conversationId, // UUID from storeIncomingMessage
          normalizedFrom, // Phone number
          customerId
        });
        
        // Fetch business info including company introduction
        const businessInfo = await queryOne<any>(
          `SELECT name, email, phone, address_line1, industry, business_type, company_introduction 
           FROM businesses WHERE id = $1`,
          [businessId]
        );

        if (!businessInfo) {
          console.error('[CRM] ❌ Business info not found, cannot generate AI response');
          return { shouldStore: true };
        }

        console.log('[CRM] ✅ Business info fetched, fetching conversation history...');
        
        // Get recent conversation history (last 10 messages)
        // conversationId here is the UUID from whatsapp_conversations.id
        const conversationHistory = await queryRows<any>(
          `SELECT direction, message_text, created_at, message_id
           FROM whatsapp_conversation_messages
           WHERE business_id = $1 AND conversation_id = $2
           ORDER BY created_at DESC, message_id DESC
           LIMIT 10`,
          [businessId, conversationId]
        );
        
        console.log('[CRM] 📜 Conversation history fetched:', {
          historyCount: conversationHistory.length,
          conversationId
        });

        // Format history for AI (DB returns newest first, so we reverse it to be chronological)
        const history = conversationHistory.reverse().map((msg: any) => ({
          role: msg.direction === 'outgoing' ? 'assistant' : 'user' as 'user' | 'assistant',
          content: msg.message_text || ''
        }));

          // Get customer info if available
          let customerInfo: any = undefined;
          if (customerId) {
            const customer = await queryOne<any>(
              `SELECT name FROM customers WHERE id = $1`,
              [customerId]
            );
            
            const orderStats = await queryOne<any>(
              `SELECT 
                 COUNT(*) as total_orders,
                 SUM(grand_total) as total_spent
               FROM invoices 
               WHERE customer_id = $1 AND status = 'final'`,
              [customerId]
            );

            if (customer) {
              customerInfo = {
                name: customer.name,
                previousOrders: orderStats?.total_orders || 0,
                totalSpent: orderStats?.total_spent || 0
              };
            }
          }

          // Check for pending order (draft status) for this conversation
          let pendingOrderInfo: any = undefined;
          if (convState === 'waiting_payment' || convContext.order_id) {
            const pendingOrderId = convContext.order_id;
            if (pendingOrderId) {
              const pendingOrder = await queryOne<any>(
                `SELECT id, order_number, grand_total, status, created_at
                 FROM sales_orders 
                 WHERE id = $1 AND business_id = $2 AND status = 'draft'`,
                [pendingOrderId, businessId]
              );
              
              if (pendingOrder) {
                // Fetch order items
                const orderItems = await queryRows<any>(
                  `SELECT item_name, qty, unit_price 
                   FROM sales_order_items 
                   WHERE sales_order_id = $1 
                   ORDER BY sort_order ASC, id ASC`,
                  [pendingOrderId]
                );
                
                pendingOrderInfo = {
                  orderNumber: pendingOrder.order_number,
                  items: orderItems.map((item: any) => ({
                    name: item.item_name,
                    quantity: parseFloat(item.qty) || 1,
                    price: parseFloat(item.unit_price) || 0
                  })),
                  totalAmount: parseFloat(pendingOrder.grand_total) || 0,
                  createdAt: pendingOrder.created_at
                };
                
                console.log('[CRM] 📦 Pending order found for AI context:', pendingOrderInfo.orderNumber);
              }
            }
          }

          // Initialize AI chatbot and generate response (retry once if provider returns empty body)
          const chatbot = new SalesAgentChatbot();
          const salesAgentRequest = {
            message: messageText,
            companyInfo: {
              name: businessInfo.name,
              introduction: businessInfo.company_introduction,
              industry: businessInfo.industry,
              businessType: businessInfo.business_type,
              phone: businessInfo.phone,
              email: businessInfo.email,
              address: businessInfo.address_line1
            },
            conversationHistory: history,
            customerInfo,
            conversationState: {
              state: convState,
              context: convContext
            },
            pendingOrder: pendingOrderInfo
          };

          let aiResponse = await chatbot.generateResponse(
            businessId,
            salesAgentRequest
          );

          let aiTrimmed =
            typeof aiResponse === 'string' ? aiResponse.trim() : '';

          if (!aiTrimmed) {
            console.warn(
              '[CRM] ⚠️ AI Sales Agent returned empty — retrying once with stricter prompt'
            );
            aiResponse = await chatbot.generateResponse(businessId, {
              ...salesAgentRequest,
              retryAfterEmpty: true
            });
            aiTrimmed =
              typeof aiResponse === 'string' ? aiResponse.trim() : '';
          }

          if (!aiTrimmed) {
            console.warn(
              '[CRM] ⚠️ AI Sales Agent still empty after retry — sending fallback'
            );
            const phone = String(businessInfo?.phone || '').trim();
            const callLine = phone
              ? `Please call us at ${phone} and we’ll help you right away.`
              : 'Please call us and we’ll help you right away.';
            return {
              response: `Sorry — we’re having trouble replying automatically right now.\n\n${callLine}`,
              shouldStore: true,
              delaySeconds: botTypingSettings.typingEnabled
                ? botTypingSettings.delaySeconds
                : 0
            };
          }

          if (aiTrimmed) {
            console.log('[CRM] 🤖 AI Sales Agent generated response');

            let finalAiResponse = aiTrimmed;

            // 1. Check for order creation tag
            if (finalAiResponse.includes('CREATE_ORDER:')) {
              try {
                // Check if there's already a draft order for this conversation (prevent duplicates)
                const existingOrder = await queryOne<any>(
                  `SELECT id, order_number, grand_total, status 
                   FROM sales_orders 
                   WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
                   ORDER BY created_at DESC LIMIT 1`,
                  [businessId, conversationId]
                );

                if (existingOrder) {
                  console.log('[CRM] ⚠️ Draft order already exists:', existingOrder.order_number);
                  // A+B: Update existing draft to match AI intent (items/qty), using DB prices.
                  const orderPart = finalAiResponse.split('CREATE_ORDER:')[1].trim();
                  const jsonMatch = orderPart.match(/\[.*\]/);
                  if (jsonMatch) {
                    const items = JSON.parse(jsonMatch[0]);
                    console.log('[CRM] 📦 Extracting items for draft update:', items);

                    const itemsWithIds = await Promise.all(
                      items.map(async (item: any) => {
                        const name = String(item?.name || '').trim();
                        const quantity = Number(item?.qty || item?.quantity || 1) || 1;
                        const dbItem = await queryOne<{ id: string; name: string; selling_price: number }>(
                          `SELECT id, name, selling_price
                           FROM items
                           WHERE business_id = $1 AND name ILIKE $2
                           ORDER BY selling_price ASC, created_at DESC
                           LIMIT 1`,
                          [businessId, name]
                        );
                        if (!dbItem) {
                          throw new Error(`Item not found in catalog: ${name}`);
                        }
                        return {
                          item_id: dbItem.id,
                          name: dbItem.name,
                          quantity,
                          price: Number(dbItem.selling_price) || 0
                        };
                      })
                    );

                    const updated = await updateDraftSalesOrderFromWhatsApp({
                      businessId,
                      orderId: existingOrder.id,
                      items: itemsWithIds,
                    });

                    convContext.total_amount = updated.total_amount;
                    convContext.order_id = existingOrder.id;
                    convContext.order_number = updated.order_number;

                    await updateConversationState(businessId, normalizedFrom, 'waiting_payment', {
                      order_id: existingOrder.id,
                      order_number: updated.order_number,
                      total_amount: updated.total_amount,
                      waiting_payment_since: new Date().toISOString()
                    });

                    // Remove CREATE_ORDER tag and ensure message references correct order + total
                    finalAiResponse = finalAiResponse.replace(/CREATE_ORDER:.*$/, '').trim();
                    if (!finalAiResponse.toLowerCase().includes(updated.order_number.toLowerCase())) {
                      finalAiResponse = `${finalAiResponse}\n\n📦 *Your Order Number:* ${updated.order_number}\n💰 *Total:* ₹${updated.total_amount}`;
                    }
                  } else {
                    // If we can't parse items, keep existing order (but still ensure state is set)
                    convContext.total_amount = parseFloat(existingOrder.grand_total);
                    convContext.order_id = existingOrder.id;
                    convContext.order_number = existingOrder.order_number;
                    await updateConversationState(businessId, normalizedFrom, 'waiting_payment', {
                      order_id: existingOrder.id,
                      order_number: existingOrder.order_number,
                      total_amount: parseFloat(existingOrder.grand_total),
                      waiting_payment_since: new Date().toISOString()
                    });
                    finalAiResponse = finalAiResponse.replace(/CREATE_ORDER:.*$/, '').trim();
                  }

                  // Inform AI that order already exists (don't send this to customer, just log)
                  console.log('[CRM] ✅ Updated/using existing draft order:', existingOrder.order_number);
                } else {
                  // No existing order, check if we have customer information
                  let finalCustomerId = customerId;
                  let customerName = convContext.customer_name;
                  let customerPhone = convContext.customer_phone || normalizedFrom;
                  let customerAddress = convContext.customer_address || convContext.shipping_address;

                  // If no customer exists, create one from conversation data
                  if (!finalCustomerId) {
                    // Get customer name from WhatsApp display name or conversation
                    const convData = await queryOne<any>(
                      `SELECT whatsapp_display_name, from_number 
                       FROM whatsapp_conversations 
                       WHERE id = $1 AND business_id = $2`,
                      [conversationId, businessId]
                    );

                    // Try to find or create customer
                    const existingCustomer = await queryOne<{ id: string }>(
                      `SELECT id FROM customers WHERE business_id = $1 AND phone = $2 LIMIT 1`,
                      [businessId, normalizedFrom]
                    );

                    if (existingCustomer) {
                      finalCustomerId = existingCustomer.id;
                      console.log('[CRM] ✅ Found existing customer:', finalCustomerId);
                      
                      // Update customer with information collected by AI if available
                      if (customerName || customerAddress) {
                        const updateFields: string[] = [];
                        const updateValues: any[] = [];
                        let paramIndex = 1;
                        
                        if (customerName) {
                          updateFields.push(`name = $${paramIndex++}`);
                          updateValues.push(customerName);
                        }
                        
                        if (customerAddress) {
                          updateFields.push(`shipping_address = $${paramIndex++}`);
                          updateValues.push(customerAddress);
                        }
                        
                        if (updateFields.length > 0) {
                          updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
                          updateValues.push(finalCustomerId);
                          await query(
                            `UPDATE customers SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
                            updateValues
                          );
                          console.log('[CRM] ✅ Updated customer with collected information');
                        }
                      }
                    } else {
                      // Create a new customer record with collected information
                      const newCustomer = await queryOne<{ id: string }>(
                        `INSERT INTO customers (business_id, name, phone, shipping_address, created_at, updated_at)
                         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                         RETURNING id`,
                        [
                          businessId,
                          customerName || convData?.whatsapp_display_name || `Customer ${normalizedFrom.substring(normalizedFrom.length - 4)}`,
                          customerPhone || normalizedFrom,
                          customerAddress || null
                        ]
                      );
                      finalCustomerId = newCustomer?.id;
                      console.log('[CRM] ✅ Created new customer with collected information:', finalCustomerId);
                    }
                  } else {
                    // Customer exists, update with collected information if available
                    if (customerName || customerAddress) {
                      const updateFields: string[] = [];
                      const updateValues: any[] = [];
                      let paramIndex = 1;
                      
                      if (customerName) {
                        updateFields.push(`name = $${paramIndex++}`);
                        updateValues.push(customerName);
                      }
                      
                      if (customerAddress) {
                        updateFields.push(`shipping_address = $${paramIndex++}`);
                        updateValues.push(customerAddress);
                      }
                      
                      if (updateFields.length > 0) {
                        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
                        updateValues.push(finalCustomerId);
                        await query(
                          `UPDATE customers SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
                          updateValues
                        );
                        console.log('[CRM] ✅ Updated existing customer with collected information');
                      }
                    }
                  }

                  const orderPart = finalAiResponse.split('CREATE_ORDER:')[1].trim();
                  const jsonMatch = orderPart.match(/\[.*\]/);
                  if (jsonMatch) {
                    const items = JSON.parse(jsonMatch[0]);
                    console.log('[CRM] 📦 Extracting items for order creation:', items);
                    
                    // Fetch item IDs and ALWAYS use DB price (do not trust AI price).
                    const itemsWithIds = await Promise.all(
                      items.map(async (item: any) => {
                        const name = String(item?.name || '').trim();
                        const quantity = Number(item?.qty || item?.quantity || 1) || 1;
                        const dbItem = await queryOne<{ id: string; name: string; selling_price: number }>(
                          `SELECT id, name, selling_price
                           FROM items
                           WHERE business_id = $1 AND name ILIKE $2
                           ORDER BY selling_price ASC, created_at DESC
                           LIMIT 1`,
                          [businessId, name]
                        );
                        if (!dbItem) {
                          throw new Error(`Item not found in catalog: ${name}`);
                        }
                        return {
                          item_id: dbItem.id,
                          name: dbItem.name,
                          quantity,
                          price: Number(dbItem.selling_price) || 0
                        };
                      })
                    );

                    // Get customer address if available
                    const customerData = finalCustomerId ? await queryOne<any>(
                      `SELECT shipping_address, address, billing_address, city, state, pincode
                       FROM customers WHERE id = $1`,
                      [finalCustomerId]
                    ) : null;

                    // Build shipping address from customer data or use collected address
                    let shippingAddress = customerAddress || null;
                    if (!shippingAddress && customerData) {
                      if (customerData.shipping_address) {
                        shippingAddress = customerData.shipping_address;
                      } else if (customerData.address) {
                        shippingAddress = customerData.address;
                      } else if (customerData.billing_address) {
                        shippingAddress = customerData.billing_address;
                      } else if (customerData.city || customerData.state || customerData.pincode) {
                        // Build address from city, state, pincode
                        const parts = [];
                        if (customerData.city) parts.push(customerData.city);
                        if (customerData.state) parts.push(customerData.state);
                        if (customerData.pincode) parts.push(customerData.pincode);
                        if (parts.length > 0) shippingAddress = parts.join(', ');
                      }
                    }

                    // Create the order with customer info and address
                    const orderResult = await createSalesOrderFromWhatsApp(
                      businessId,
                      itemsWithIds,
                      normalizedFrom, // phone
                      finalCustomerId || undefined,
                      conversationId, // UUID
                      shippingAddress || undefined
                    );

                    console.log('[CRM] ✅ Created sales order:', orderResult.order_number);

                    // Update context for this message processing
                    convContext.total_amount = orderResult.total_amount;
                    convContext.order_id = orderResult.order_id;

                    // Link customer to conversation if not already linked
                    if (finalCustomerId) {
                      await query(
                        `UPDATE whatsapp_conversations SET customer_id = $1 WHERE id = $2 AND business_id = $3`,
                        [finalCustomerId, conversationId, businessId]
                      );
                    }

                    // Set state to waiting_payment
                    await updateConversationState(businessId, normalizedFrom, 'waiting_payment', {
                      order_id: orderResult.order_id,
                      order_number: orderResult.order_number,
                      total_amount: orderResult.total_amount,
                      waiting_payment_since: new Date().toISOString()
                    });

                    // Remove the tag from the final response sent to user
                    finalAiResponse = finalAiResponse.replace(/CREATE_ORDER:.*$/, '').trim();
                    
                    // Add order number to the response if not already mentioned
                    if (!finalAiResponse.toLowerCase().includes(orderResult.order_number.toLowerCase()) && 
                        !finalAiResponse.toLowerCase().includes('order number')) {
                      finalAiResponse += `\n\n📦 *Your Order Number:* ${orderResult.order_number}`;
                    }
                  }
                }
              } catch (e) {
                console.error('[CRM] Failed to parse order items from AI response:', e);
              }
            }

            // 2. Check if user is asking for order number
            const isAskingForOrderNumber = 
              messageLower.includes('order number') ||
              messageLower.includes('order no') ||
              messageLower.includes('order #') ||
              messageLower.includes('what is my order') ||
              messageLower.includes('my order number') ||
              messageLower.includes('order id') ||
              (messageLower.includes('order') && (messageLower.includes('what') || messageLower.includes('which') || messageLower.includes('tell')));
            
            if (isAskingForOrderNumber) {
              // Check if user is asking for all orders
              const isAskingForAllOrders = 
                messageLower.includes('all orders') ||
                messageLower.includes('my orders') ||
                messageLower.includes('list orders') ||
                messageLower.includes('all my orders');
              
              if (isAskingForAllOrders) {
                // Get all orders for this conversation
                const allOrders = await queryRows<{ order_number: string; created_at: Date; status: string }>(
                  `SELECT order_number, created_at, status FROM sales_orders 
                   WHERE business_id = $1 AND whatsapp_conversation_id = $2 
                   ORDER BY created_at DESC LIMIT 10`,
                  [businessId, conversationId]
                );
                
                if (allOrders && allOrders.length > 0) {
                  const orderList = allOrders.map((o, idx) => 
                    `${idx + 1}. ${o.order_number} (${o.status === 'draft' ? 'Pending' : o.status})`
                  ).join('\n');
                  
                  if (!finalAiResponse.toLowerCase().includes('order number')) {
                    finalAiResponse = `${finalAiResponse}\n\n📦 *Your Orders:*\n${orderList}`;
                  }
                } else {
                  console.log('[CRM] User asked for all orders but none found');
                }
              } else {
                // User is asking for a specific order number (most likely the current one)
                // Priority: 1. Current order in context (waiting_payment state), 2. Latest order
                
                let orderNumber = null;
                
                // First, check if we're in waiting_payment state (current order)
                if (convState === 'waiting_payment' && convContext.order_number) {
                  orderNumber = convContext.order_number;
                }
                
                // If not in context, try to get from order_id in context
                if (!orderNumber && convContext.order_id) {
                  const order = await queryOne<{ order_number: string }>(
                    `SELECT order_number FROM sales_orders WHERE id = $1 AND business_id = $2`,
                    [convContext.order_id, businessId]
                  );
                  orderNumber = order?.order_number;
                }
                
                // If still not found, get latest order for this conversation
                if (!orderNumber) {
                  const latestOrder = await queryOne<{ order_number: string; created_at: Date }>(
                    `SELECT order_number, created_at FROM sales_orders 
                     WHERE business_id = $1 AND whatsapp_conversation_id = $2 
                     ORDER BY created_at DESC LIMIT 1`,
                    [businessId, conversationId]
                  );
                  orderNumber = latestOrder?.order_number;
                  
                  // Check if there are multiple orders
                  if (latestOrder) {
                    const orderCount = await queryOne<{ count: number }>(
                      `SELECT COUNT(*) as count FROM sales_orders 
                       WHERE business_id = $1 AND whatsapp_conversation_id = $2`,
                      [businessId, conversationId]
                    );
                    
                    if (orderCount && orderCount.count > 1 && orderNumber) {
                      // Mention that this is the latest order if there are multiple
                      if (!finalAiResponse.toLowerCase().includes(orderNumber.toLowerCase())) {
                        finalAiResponse = `${finalAiResponse}\n\n📦 *Your Latest Order Number:* ${orderNumber}\n\n(You have ${orderCount.count} orders. Say "all orders" to see all of them.)`;
                      }
                    } else if (orderNumber) {
                      // Single order, just show the number
                      if (!finalAiResponse.toLowerCase().includes(orderNumber.toLowerCase())) {
                        finalAiResponse = `${finalAiResponse}\n\n📦 *Your Order Number:* ${orderNumber}`;
                      }
                    }
                  }
                } else {
                  // Found order from context
                  if (!finalAiResponse.toLowerCase().includes(orderNumber.toLowerCase())) {
                    finalAiResponse = `${finalAiResponse}\n\n📦 *Your Order Number:* ${orderNumber}`;
                  }
                }
                
                if (!orderNumber) {
                  // No order found - let AI handle the response naturally
                  console.log('[CRM] User asked for order number but no order found');
                }
              }
            }
            
            // 3. Check if the AI is trying to send a payment link (by placeholder or by keywords)
            const aiLower = finalAiResponse.toLowerCase();
            
            // Log for debugging
            const isWaitingPaymentState = (convState as string) === 'waiting_payment';
            console.log('[CRM] 🤖 AI Response Link Check:', {
              hasPlaceholder: finalAiResponse.includes('[insert payment link]'),
              isWaitingPayment: isWaitingPaymentState,
              messageText: messageText,
              aiResponse: finalAiResponse
            });

            const isRequestingPaymentLink = 
              finalAiResponse.includes('[insert payment link]') || 
              finalAiResponse.includes('[payment link]') ||
              (messageLower.includes('send') && messageLower.includes('link')) ||
              (messageLower.includes('payment') && messageLower.includes('link')) ||
              (isWaitingPaymentState && (
                messageLower.includes('ready') || 
                messageLower.includes('send') || 
                messageLower.includes('payment link') ||
                messageLower.includes('pay') ||
                messageLower.includes('ok') ||
                messageLower.includes('yes') ||
                messageLower.includes('online') ||
                aiLower.includes('payment link') ||
                aiLower.includes('bank transfer') ||
                aiLower.includes('transfer')
              ));

            if (isRequestingPaymentLink) {
              // Fetch latest draft order if we don't have it in context
              let orderAmount = convContext.total_amount;
              let orderId = convContext.order_id;
              // IMPORTANT: we need an orderId for PSP-hosted links (webhook matching).
              // If amount exists but orderId is missing, still fetch the latest draft order.
              if (!orderAmount || !orderId) {
                const latestOrder = await queryOne<any>(
                  `SELECT id, grand_total FROM sales_orders 
                   WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
                   ORDER BY created_at DESC LIMIT 1`,
                  [businessId, conversationId]
                );
                orderId = latestOrder?.id || orderId;
                if (!orderAmount) {
                  orderAmount = latestOrder?.grand_total ? parseFloat(latestOrder.grand_total) : 0;
                }
              }

              if (orderAmount > 0) {
                // Fetch payment method and generate link.
                // Requirement: if anything breaks, apologize and ask to call us (do not silently fail).
                let paymentInfo: Awaited<ReturnType<typeof generatePaymentLinkForBusiness>> = null;
                try {
                  paymentInfo = await generatePaymentLinkForBusiness(businessId, {
                    orderId,
                    amount: orderAmount,
                    customerName: whatsappDisplayName || normalizedFrom
                  });
                } catch (e: any) {
                  console.error('[CRM] ⚠️ Payment link generation failed:', e);
                  const phone = String(businessInfo?.phone || '').trim();
                  const callLine = phone ? `Please call us at ${phone} and we’ll help you right away.` : 'Please call us and we’ll help you right away.';
                  return {
                    response: `Sorry — we’re facing a technical issue right now.\n\n${callLine}`,
                    shouldStore: true,
                    delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
                  };
                }

                if (!paymentInfo) {
                  // No link could be generated (missing config, no active provider, etc.).
                  // Never send placeholders to customer.
                  const cleaned = finalAiResponse.replace(/\[insert payment link\]|\[payment link\]/g, '').trim();
                  const phone = String(businessInfo?.phone || '').trim();
                  const callLine = phone ? `Please call us at ${phone} and we’ll help you right away.` : 'Please call us and we’ll help you right away.';
                  return {
                    response: `${cleaned}\n\nSorry — we couldn’t generate a payment link right now.\n\n${callLine}`.trim(),
                    shouldStore: true,
                    delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
                  };
                }

                if (paymentInfo) {
                  // Remove placeholder if exists from text
                  if (finalAiResponse.includes('[insert payment link]')) {
                    finalAiResponse = finalAiResponse.replace('[insert payment link]', '').trim();
                  } else if (finalAiResponse.includes('[payment link]')) {
                    finalAiResponse = finalAiResponse.replace('[payment link]', '').trim();
                  }
                  
                  // Remove any existing payment link URLs from the text
                  finalAiResponse = finalAiResponse.replace(/upi:\/\/pay\?[^\s]*/gi, '').trim();
                  finalAiResponse = finalAiResponse.replace(/https?:\/\/[^\s]*/gi, '').trim();
                  finalAiResponse = finalAiResponse.replace(/payment\s+link[^\n]*/gi, '').trim();
                  finalAiResponse = finalAiResponse.replace(/here['']?s\s+the\s+payment\s+link[^\n]*/gi, '').trim();
                  
                  // Clean up extra newlines
                  finalAiResponse = finalAiResponse.replace(/\n{3,}/g, '\n\n').trim();
                  
                  // Check if payment link is UPI (upi:// protocol)
                  const isUPILink = paymentInfo.link.startsWith('upi://');
                  
                  if (isUPILink) {
                    // UPI links don't work in WhatsApp buttons - send as plain text link instead
                    // Users can tap the link directly in the message to open their UPI app
                    if (!finalAiResponse.toLowerCase().includes('payment') && !finalAiResponse.toLowerCase().includes('pay')) {
                      finalAiResponse += `\n\n💳 Payment Link:\n${paymentInfo.link}`;
                  } else {
                      finalAiResponse += `\n\n${paymentInfo.link}`;
                  }
                  
                    // Add screenshot instruction (only once)
                    if (!finalAiResponse.toLowerCase().includes('screenshot')) {
                  finalAiResponse += `\n\nPlease send the payment screenshot here once done.`;
                    }
                  
                  // Ensure state is waiting_payment
                  if ((convState as string) !== 'waiting_payment') {
                    await updateConversationState(businessId, normalizedFrom, 'waiting_payment', {
                      total_amount: orderAmount,
                      waiting_payment_since: new Date().toISOString()
                    });
                  }

                    // Return as plain text (no button) - UPI links work better as clickable text links
                  return {
                    response: finalAiResponse,
                      shouldStore: true,
                      delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
                    };
                  } else {
                    // For HTTP/HTTPS links, use button (e.g., payment gateway URLs)
                    if (!finalAiResponse.toLowerCase().includes('payment') && !finalAiResponse.toLowerCase().includes('pay')) {
                      finalAiResponse += `\n\n💳 Please click the button below to complete your payment.`;
                    }
                    
                    // Add screenshot instruction (only once)
                    if (!finalAiResponse.toLowerCase().includes('screenshot')) {
                      finalAiResponse += `\n\nPlease send the payment screenshot here once done.`;
                    }
                    
                    // Ensure state is waiting_payment
                    if ((convState as string) !== 'waiting_payment') {
                      await updateConversationState(businessId, normalizedFrom, 'waiting_payment', {
                        total_amount: orderAmount,
                        waiting_payment_since: new Date().toISOString()
                      });
                    }

                    // Return with button for HTTP/HTTPS links
                    return {
                      response: finalAiResponse,
                      shouldStore: true,
                      responseType: 'button',
                      buttons: [
                        {
                          id: 'payment_link',
                          title: '💳 Pay Now',
                          type: 'url',
                          url: paymentInfo.link
                        }
                      ],
                      footer: 'Click the button to open payment',
                      delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
                    };
                  }
                }
              } else {
                console.log('[CRM] ⚠️ AI requested payment link but no active draft order found');
                // Replace placeholder with helpful message if no order found
                finalAiResponse = finalAiResponse.replace(/\[insert payment link\]|\[payment link\]/g, '(Please confirm your order details first so I can generate a link)');
              }
            }
            
            // Log automation event
            // This ensures AI chatbot responses are properly counted in Bot vs Human metrics
            try {
              await logAutomationEvent(
                conversationId,
                businessId,
                'bot_message',
                {
                  message_type: 'text',
                  source: 'ai_chatbot',
                  has_buttons: false,
                  response_preview: finalAiResponse.substring(0, 100)
                }
              );
              console.log('[CRM] ✅ Logged bot_message automation event for AI chatbot response');
            } catch (err) {
              console.error('[CRM] Error logging automation event for AI response:', err);
              // Non-critical: continue even if event logging fails
            }
            
            // Clean up any JSON or technical tags from AI response before sending to customer
            // Remove CREATE_ORDER tags if not already removed
            finalAiResponse = finalAiResponse.replace(/CREATE_ORDER:.*$/gm, '').trim();
            
            // Remove any JSON arrays that might have leaked into the response
            finalAiResponse = finalAiResponse.replace(/\[\s*\{[^}]+\}\s*\]/g, '').trim();
            
            // Clean up any double newlines
            finalAiResponse = finalAiResponse.replace(/\n{3,}/g, '\n\n');
            
            // Note: Lead analysis already triggered after storing incoming message above
            // No need to call again here to avoid duplicate analysis
            
            return {
              response: finalAiResponse.trim(),
              shouldStore: true,
              delaySeconds: botTypingSettings.typingEnabled ? botTypingSettings.delaySeconds : 0
            };
          }
      } catch (error) {
        console.error('[CRM] ❌ AI Sales Agent error:', error);
        console.error('[CRM] AI Error Stack:', error instanceof Error ? error.stack : 'No stack trace');
        // Requirement: if anything breaks, apologize and ask to call us (do not silently fail).
        const bizPhone = await queryOne<{ phone?: string }>(
          `SELECT phone FROM businesses WHERE id = $1`,
          [businessId]
        );
        const phone = String(bizPhone?.phone || '').trim();
        const callLine = phone ? `Please call us at ${phone} and we’ll help you right away.` : 'Please call us and we’ll help you right away.';
        return {
          response: `Sorry — we’re facing a technical issue right now.\n\n${callLine}`,
          shouldStore: true
        };
      }
    } else {
      console.log('[CRM] ⏭️ Skipping AI chatbot:', {
        isGroup,
        messageType,
        hasMessageText: !!messageText.trim(),
        convState,
        reason: isGroup ? 'group chat' : messageType !== 'text' ? 'not text message' : !messageText.trim() ? 'empty message' : convState === 'waiting_payment' ? 'waiting for payment' : 'unknown'
      });
    }

    // Skip auto-reply for groups if no rule matched
    if (isGroup) {
      return {
        response: undefined,
        shouldStore: true
      };
    }
    

    // Handle payment screenshot receipt (OCR only if still pending and webhook grace elapsed)
    if (convState === 'waiting_payment' && messageType === 'image' && mediaUrl) {
      console.log('[CRM] 📸 Received image in waiting_payment state, assuming payment screenshot');
      
      try {
        // PSP may have confirmed payment after the top-of-handler check (many awaits above)
        const paidImmediate = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
          businessId,
          whatsappConversationUuid: conversationId,
          normalizedFrom
        });
        if (paidImmediate) return paidImmediate;

        const latestOrder = await queryOne<{
          id: string;
          order_number: string;
          grand_total: string;
          payment_status: string | null;
          updated_at: Date;
        }>(
          `SELECT id, order_number, grand_total::text, payment_status, updated_at
           FROM sales_orders
           WHERE business_id = $1 AND whatsapp_conversation_id = $2 AND status = 'draft'
           ORDER BY created_at DESC
           LIMIT 1`,
          [businessId, conversationId]
        );

        if (latestOrder) {
          /** Integrated PSP session — OCR must not run; wait for webhook. */
          const expectPspWebhook = await hasPendingGatewayPaymentTransaction(
            businessId,
            latestOrder.id
          );

          const messageRecord = await queryOne<{ id: string }>(
            `SELECT id FROM whatsapp_conversation_messages 
             WHERE message_id = $1 AND business_id = $2
             LIMIT 1`,
            [messageId, businessId]
          );

          if (!messageRecord) {
            console.warn(`[CRM] ⚠️ Message with message_id "${messageId}" not found in database. Payment screenshot will be linked without message reference.`);
          }

          const pendingPatch = expectPspWebhook
            ? `jsonb_build_object(
                 'ocr_workflow', 'awaiting_psp',
                 'ocr_skipped_reason', 'pending_gateway_payment_transaction'
               )`
            : `jsonb_build_object(
                 'ocr_workflow', 'manual_ocr_eligible'
               )`;

          const attached = await queryOne<{ id: string }>(
            `UPDATE sales_orders 
             SET payment_screenshot_url = $1, 
                 payment_screenshot_message_id = $2,
                 ocr_status = CASE WHEN $4::boolean THEN 'awaiting_psp' ELSE 'pending' END,
                 ocr_data = COALESCE(ocr_data, '{}'::jsonb) || ${pendingPatch},
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $3
               AND (payment_status IS NULL OR payment_status IS DISTINCT FROM 'paid')
             RETURNING id`,
            [mediaUrl, messageRecord?.id || null, latestOrder.id, expectPspWebhook]
          );

          if (!attached) {
            const paidOnAttach = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
              businessId,
              whatsappConversationUuid: conversationId,
              normalizedFrom
            });
            if (paidOnAttach) return paidOnAttach;
            await clearConversationState(businessId, normalizedFrom);
            return {
              response:
                'Thanks for the screenshot — your payment is already confirmed.',
              shouldStore: true
            };
          }

          const paidAfterAttach = await maybeConfirmWhatsAppOrderIfPaidByWebhook({
            businessId,
            whatsappConversationUuid: conversationId,
            normalizedFrom
          });
          if (paidAfterAttach) return paidAfterAttach;

          const statusRow = await queryOne<{ payment_status: string | null }>(
            `SELECT payment_status FROM sales_orders WHERE id = $1`,
            [latestOrder.id]
          );
          const stillPending = statusRow?.payment_status !== 'paid';
          const graceExceeded = isWebhookGraceExceeded(
            convContext.waiting_payment_since,
            latestOrder.updated_at
          );

          if (stillPending && !graceExceeded) {
            return {
              response: expectPspWebhook
                ? "Thanks for the screenshot — we're waiting for the payment provider to confirm. You don't need to send it again."
                : "Thanks for the screenshot — we're still waiting for your payment to confirm. If it takes a little longer, we'll use this image automatically — no need to resend.",
              shouldStore: true
            };
          }

          if (stillPending && graceExceeded && expectPspWebhook) {
            await query(
              `UPDATE sales_orders
               SET ocr_status = 'awaiting_psp',
                   ocr_data = COALESCE(ocr_data, '{}'::jsonb)
                     || jsonb_build_object(
                       'ocr_skipped_reason', 'integrated_gateway_no_ocr',
                       'ocr_note', 'PSP webhook expected — OCR disabled for this order'
                     ),
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`,
              [latestOrder.id]
            );
            return {
              response:
                "We've saved your screenshot. This order uses online checkout — we're waiting for the payment provider to confirm. If something looks wrong, our team will reach out.",
              shouldStore: true
            };
          }

          if (stillPending && graceExceeded && !expectPspWebhook) {
            const expectedAmount = parseFloat(latestOrder.grand_total);
            verifyPaymentScreenshot(businessId, mediaUrl, expectedAmount)
              .then(async (ocrResult) => {
                console.log('[CRM] 🤖 AI OCR Verification Result:', ocrResult);

                const evaluated = evaluatePaymentOcrWithRules(ocrResult, {
                  expectedAmount
                });
                const notesLine =
                  evaluated.ocrStatus === 'requires_review'
                    ? evaluated.summary
                    : evaluated.ocrStatus === 'rejected'
                      ? evaluated.summary
                      : null;

                await query(
                  `UPDATE sales_orders 
                   SET ocr_status = $1, 
                       ocr_data = $2::jsonb,
                       notes = COALESCE($3, notes),
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $4`,
                  [
                    evaluated.ocrStatus,
                    JSON.stringify({
                      ...ocrResult,
                      expected_amount: expectedAmount,
                      received_amount: ocrResult.extractedAmount,
                      verification_source: 'ocr_fallback',
                      effective_confidence: evaluated.effectiveConfidence,
                      validation: evaluated.ruleChecks,
                      validation_summary: evaluated.summary
                    }),
                    notesLine,
                    latestOrder.id
                  ]
                );
              })
              .catch(err => console.error('[CRM] OCR Background Error:', err));

            await clearConversationState(businessId, normalizedFrom);

            return {
              response:
                "Thank you for sharing the screenshot! I've received it and will verify the payment. You'll receive a confirmation shortly.",
              shouldStore: true
            };
          }

          await clearConversationState(businessId, normalizedFrom);
          return {
            response: 'Thanks for the screenshot!',
            shouldStore: true
          };
        }
      } catch (error) {
        console.error('[CRM] Error processing payment screenshot:', error);
      }
    }

    // Check for bot commands
    if (messageLower === 'create invoice' || messageLower === 'new invoice') {
      // Start invoice creation flow
      await updateConversationState(businessId, normalizedFrom, 'waiting_item_name', { items: [] });
      return {
        response: 'Great! Let\'s create an invoice. Please send me the item name:',
        shouldStore: false
      };
    }

    // Cancel order (DB-backed) + clear flow state
    const cancelOrderIntent =
      messageLower.includes('cancel order') ||
      messageLower.includes('cancel my order') ||
      messageLower.includes('cancel the order') ||
      messageLower.includes('cancel this order') ||
      messageLower.includes('cancel my purchase') ||
      messageLower.includes('cancel purchase');
    if (!isGroup && cancelOrderIntent) {
      try {
        const r = await cancelLatestDraftOrderForConversation({
          businessId,
          whatsappConversationUuid: conversationId,
        });
        await clearConversationState(businessId, normalizedFrom);
        if (r.cancelled) {
          return {
            response: `Your order ${r.orderNumber ? `(${r.orderNumber}) ` : ''}has been cancelled. If you need anything else, just tell me.`,
            shouldStore: true
          };
        }
        return {
          response: 'I couldn’t find any active order to cancel. If you want to place a new order, tell me what you need.',
          shouldStore: true
        };
      } catch (e) {
        console.error('[CRM] Cancel order failed:', e);
        return {
          response: 'Sorry — I couldn’t cancel your order right now due to a technical issue. Please call us and we’ll help you right away.',
          shouldStore: true
        };
      }
    }

    if (messageLower === 'cancel' || messageLower === 'exit' || messageLower === 'stop') {
      // Cancel current flow
      await clearConversationState(businessId, normalizedFrom);
      return {
        response: 'Cancelled. How can I help you?',
        shouldStore: false
      };
    }

    // Handle state machine
    if (convState === 'waiting_item_name') {
      // Search for item
      const items = await searchItems(businessId, messageText);
      
      if (items.length === 0) {
        return {
          response: `Item "${messageText}" not found. Please check the spelling or type "cancel" to exit.`,
          shouldStore: false
        };
      }

      if (items.length === 1) {
        // Single match - ask for quantity
        const item = items[0];
        const newContext: ConversationContext = {
          ...convContext,
          items: convContext.items || [],
          current_item: item.id
        };
        await updateConversationState(businessId, normalizedFrom, 'waiting_quantity', newContext);
        return {
          response: `Found: ${item.name} (₹${item.selling_price}/unit). How many units?`,
          shouldStore: false
        };
      } else {
        // Multiple matches - ask user to specify
        const itemList = items.map((item, idx) => `${idx + 1}. ${item.name} - ₹${item.selling_price}`).join('\n');
        return {
          response: `Multiple items found:\n${itemList}\n\nPlease send the exact item name or number:`,
          shouldStore: false
        };
      }
    }

    if (convState === 'waiting_quantity') {
      const quantity = parseFloat(messageText);
      if (isNaN(quantity) || quantity <= 0) {
        return {
          response: 'Please send a valid quantity (number greater than 0).',
          shouldStore: false
        };
      }

      if (!convContext.current_item) {
        await clearConversationState(businessId, normalizedFrom);
        return {
          response: 'Error: Item not found. Please start over by typing "create invoice".',
          shouldStore: false
        };
      }

      // Get item details
      const item = await queryOne<{ id: string; name: string; selling_price: number }>(
        `SELECT id, name, selling_price FROM items WHERE id = $1 AND business_id = $2`,
        [convContext.current_item, businessId]
      );

      if (!item) {
        await clearConversationState(businessId, normalizedFrom);
        return {
          response: 'Error: Item not found. Please start over.',
          shouldStore: false
        };
      }

      // Add item to context
      const items = convContext.items || [];
      items.push({
        name: item.name,
        quantity: quantity,
        price: item.selling_price,
        item_id: item.id
      });

      const newContext: ConversationContext = {
        ...convContext,
        items,
        current_item: undefined
      };

      await updateConversationState(businessId, normalizedFrom, 'waiting_confirm', newContext);

      // Calculate total
      const total = items.reduce((sum, item) => sum + (item.price || 0) * item.quantity, 0);
      const itemList = items.map(item => `${item.name} x ${item.quantity} = ₹${(item.price || 0) * item.quantity}`).join('\n');

      return {
        response: `Invoice Summary:\n${itemList}\n\nTotal: ₹${total}\n\nType "confirm" to create invoice or send another item name to add more items.`,
        shouldStore: false
      };
    }

    if (convState === 'waiting_confirm') {
      if (messageLower === 'confirm' || messageLower === 'yes') {
        // Create invoice
        await updateConversationState(businessId, normalizedFrom, 'creating_invoice', convContext);
        
        const items = convContext.items || [];
        if (items.length === 0) {
          await clearConversationState(businessId, normalizedFrom);
          return {
            response: 'No items to invoice. Please start over.',
            shouldStore: false
          };
        }

        // Create invoice
        try {
          const invoiceData = await createCashSaleInvoice(
            businessId,
            items.map(item => ({
              item_id: item.item_id!,
              quantity: item.quantity,
              price: item.price,
              name: item.name
            })),
            customerId || undefined
          );

          await clearConversationState(businessId, normalizedFrom);
          return {
            response: `✅ Invoice created successfully!\n\nInvoice Number: ${invoiceData.invoice_number}\nTotal Items: ${items.length}\n\nThank you for your order!`,
            shouldStore: false
          };
        } catch (error: any) {
          console.error('[CRM] Error creating invoice:', error);
          await clearConversationState(businessId, normalizedFrom);
          return {
            response: `❌ Sorry, I couldn't create the invoice. Error: ${error.message}\n\nPlease try again or contact support.`,
            shouldStore: false
          };
        }
      } else {
        // Treat as new item name
        const items = await searchItems(businessId, messageText);
        if (items.length === 0) {
          return {
            response: `Item "${messageText}" not found. Type "confirm" to finish or send another item name.`,
            shouldStore: false
          };
        }

        if (items.length === 1) {
          const item = items[0];
          const newContext: ConversationContext = {
            ...convContext,
            current_item: item.id
          };
          await updateConversationState(businessId, normalizedFrom, 'waiting_quantity', newContext);
          return {
            response: `Found: ${item.name} (₹${item.selling_price}/unit). How many units?`,
            shouldStore: false
          };
        } else {
          const itemList = items.map((item, idx) => `${idx + 1}. ${item.name} - ₹${item.selling_price}`).join('\n');
          return {
            response: `Multiple items found:\n${itemList}\n\nPlease send the exact item name:`,
            shouldStore: false
          };
        }
      }
    }

    // Default response for idle state - only show if NO bot rules exist
    // This preserves backward compatibility but doesn't override custom bot rules
    if (convState === 'idle') {
      const { queryOne } = await import('@/lib/db');
      const hasRules = await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM whatsapp_bot_rules 
         WHERE business_id = $1 AND is_active = true`,
        [businessId]
      );

      // Only show default response if no bot rules are configured
      if ((hasRules?.count || 0) === 0) {
        return {
          response: 'Hello! I can help you with:\n• Create invoice: Type "create invoice"\n• Check prices: Ask "price of [item]"\n• Check stock: Ask "stock of [item]"\n\nHow can I help?',
          shouldStore: false
        };
      }
      // If bot rules exist but none matched, don't send default response
      // This allows users to create fallback rules instead
    }

    // Unknown state or message
    return {
      response: undefined,
      shouldStore: true
    };
  } catch (error: any) {
    // Log error but don't send error message to users
    // Internal errors should be handled silently to avoid spamming users
    console.error('[CRM] ❌ Error processing message:', {
      error: error.message || error,
      stack: error.stack,
      businessId,
      fromJid,
      messageText: messageText.substring(0, 50)
    });
    
    // Return undefined response so no message is sent to user
    // Store the incoming message so it's recorded in the database
    // This way, even if processing fails, the message is still saved
    return {
      response: undefined, // Don't send error message to users
      shouldStore: true // Still store the incoming message in database
    };
  }
}

/**
 * Detect critical signals in message that require immediate recalculation
 */
function detectCriticalSignals(message: string, existingProfile?: { lead_score?: number; lead_status?: string }): boolean {
  if (!message) return false;
  
  const messageLower = message.toLowerCase().trim();
  
  // Negative signals that should trigger immediate recalculation
  const negativeSignals = [
    /\b(not interested|no interest|not interested anymore|lost interest)\b/i,
    /\b(no thanks|no thank you|not needed|don't need|don't want)\b/i,
    /\b(cancel|canceled|cancelled|cancellation)\b/i,
    /\b(declined|rejected|refused)\b/i,
    /\b(too expensive|too costly|can't afford|out of budget)\b/i,
    /\b(bought from|purchased from|ordered from) (another|other|competitor)\b/i,
    /\b(changed mind|not anymore|changed decision)\b/i,
    /\b(stop|don't contact|remove me|unsubscribe)\b/i,
    /\b(wrong number|wrong person|not for me)\b/i
  ];
  
  // Positive signals that might increase score
  // Enhanced patterns to catch purchase intent: "I want 5 bottles", "I would like to purchase", etc.
  const positiveSignals = [
    /\b(want to buy|ready to buy|place order|make purchase|would like to purchase|like to buy|want.*purchase)\b/i,
    /\b(want.*\d+|want.*bottles?|want.*pieces?|want.*units?|want.*items?)\b/i, // "I want 5 bottles", "want 3 pieces"
    /\b(interested|very interested|definitely interested)\b/i,
    /\b(urgent|asap|immediately|right away|today)\b/i,
    /\b(price is good|good price|acceptable price|agree|deal|total price|final price)\b/i,
    /\b(confirm|confirmed|yes.*purchase|yes.*buy|yes.*order|proceed|go ahead)\b/i,
    /\b(payment|pay now|send invoice|bill me|give me.*price|calculate.*price|total.*price)\b/i,
    /\b(delivery address|send to|shipping address|when.*deliver|how.*deliver)\b/i,
    /\b(how much.*total|what.*total|give.*total|calculate.*total)\b/i // "give me the total price"
  ];
  
  // Check for negative signals
  const hasNegativeSignal = negativeSignals.some(pattern => pattern.test(messageLower));
  
  // Check for strong positive signals (only if previous score was low)
  const hasPositiveSignal = positiveSignals.some(pattern => pattern.test(messageLower));
  const previousScoreLow = existingProfile?.lead_score && existingProfile.lead_score < 50;
  
  // Trigger immediate recalculation if:
  // 1. Negative signal detected (ALWAYS)
  // 2. Strong positive signal detected AND previous score was low
  if (hasNegativeSignal) {
    console.log('[CRM] 🚨 Negative signal detected - will recalculate immediately');
    return true;
  }
  
  if (hasPositiveSignal && previousScoreLow) {
    console.log('[CRM] ✅ Positive signal detected with low previous score - will recalculate immediately');
    return true;
  }
  
  return false;
}

/**
 * Analyze conversation and update lead profile
 * Called in background after incoming messages or AI agent responds
 */
async function analyzeAndUpdateLeadProfile(
  businessId: string,
  conversationId: string,
  phone: string,
  customerId?: string,
  latestMessage?: string // Latest incoming message to detect signals
): Promise<void> {
  try {
    console.log('[CRM] 🔍 Analyzing lead profile for conversation:', conversationId);
    
    // First check: Skip group chats - lead scoring only applies to individual customer conversations
    const conversationCheck = await queryOne<{ is_group: boolean }>(
      `SELECT is_group FROM whatsapp_conversations WHERE id = $1 AND business_id = $2`,
      [conversationId, businessId]
    );

    if (conversationCheck?.is_group === true) {
      console.log('[CRM] ⏭️ Skipping lead analysis for group chat (conversation_id:', conversationId, ')');
      return;
    }
    
    // Check if lead analyzer is enabled
    const config = await queryOne<{ lead_analyzer_enabled: boolean }>(
      `SELECT lead_analyzer_enabled FROM ai_provider_config WHERE business_id = $1`,
      [businessId]
    );

    if (!config || !config.lead_analyzer_enabled) {
      console.log('[CRM] Lead analyzer disabled, skipping');
      return;
    }

    // Get current message count from conversation (more accurate than profile)
    const messageCountResult = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int as count 
       FROM whatsapp_conversation_messages 
       WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, conversationId]
    );
    const currentMessageCount = messageCountResult?.count || 0;

    // Check if profile exists and get latest score
    const existing = await queryOne<{ id: string; total_messages: number; lead_score: number; lead_status: string }>(
      `SELECT id, total_messages, lead_score, lead_status FROM whatsapp_lead_profiles 
       WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, conversationId]
    );

    // Check for critical signals that require IMMEDIATE recalculation
    const shouldRecalculateImmediately = latestMessage && existing ? detectCriticalSignals(latestMessage, existing) : false;

    // Only analyze every 3-5 messages to avoid excessive API calls, UNLESS there are critical signals
    // For new conversations (first message), always analyze
    // For critical signals (negative/positive), always analyze immediately
    // Otherwise, analyze every 3 messages (more frequent than before for better tracking)
    const shouldAnalyze = 
      currentMessageCount === 0 || // First message
      shouldRecalculateImmediately || // Critical signal detected
      currentMessageCount % 3 === 0; // Every 3 messages (was 5)

    if (!shouldAnalyze) {
      console.log('[CRM] Skipping analysis - not at analysis interval and no critical signals detected', {
        currentMessageCount,
        isMultipleOf3: currentMessageCount % 3 === 0,
        hasCriticalSignal: shouldRecalculateImmediately
      });
      return;
    }

    if (shouldRecalculateImmediately) {
      console.log('[CRM] 🚨 Critical signal detected - forcing immediate recalculation:', {
        message: latestMessage?.substring(0, 100),
        previousScore: existing?.lead_score,
        previousStatus: existing?.lead_status
      });
    }

    // Get MOST RECENT conversation messages for analysis (prioritize latest context)
    // Get last 100 messages to focus on recent purchase intent and conversations
    // Order by DESC to get most recent first, then reverse for chronological analysis
    const messages = await queryRows<any>(
      `SELECT direction, message_text, created_at, message_id
       FROM whatsapp_conversation_messages
       WHERE business_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC, message_id DESC
       LIMIT 100`,
      [businessId, conversationId]
    );

    // Reverse to get chronological order (oldest to newest) for proper conversation flow
    const messagesChronological = messages.reverse();

    if (messagesChronological.length < 3) {
      console.log('[CRM] Not enough messages for analysis');
      return;
    }

    // Get business info
    const businessInfo = await queryOne<{ name: string; industry?: string }>(
      `SELECT name, industry FROM businesses WHERE id = $1`,
      [businessId]
    );

    // Format messages for analyzer (use chronological order for proper context)
    const formattedMessages = messagesChronological.map((msg: any) => ({
      role: msg.direction === 'outgoing' ? 'assistant' : 'user' as 'user' | 'assistant',
      content: msg.message_text || '',
      timestamp: msg.created_at
    }));

    // Analyze with AI
    const analyzer = new LeadAnalyzer();
    const analysis = await analyzer.analyzeLead(businessId, {
      messages: formattedMessages,
      companyInfo: businessInfo || undefined
    });

    if (!analysis) {
      console.log('[CRM] Lead analysis returned null, skipping update');
      return;
    }

    // Calculate conversation stats from actual database counts (more accurate)
    const stats = await queryOne<{ user_messages: number; business_messages: number }>(
      `SELECT 
        COUNT(*) FILTER (WHERE direction = 'incoming')::int as user_messages,
        COUNT(*) FILTER (WHERE direction = 'outgoing')::int as business_messages
       FROM whatsapp_conversation_messages
       WHERE business_id = $1 AND conversation_id = $2`,
      [businessId, conversationId]
    );
    const userMessages = stats?.user_messages || 0;
    const businessMessages = stats?.business_messages || 0;
    const responseRate = userMessages > 0 ? (businessMessages / userMessages) * 100 : 0;

    // Update or insert lead profile
    if (existing) {
      await queryRows(
        `UPDATE whatsapp_lead_profiles SET
          lead_score = $3,
          lead_status = $4,
          interest_level = $5,
          behavior_tags = $6,
          sentiment = $7,
          key_topics = $8,
          purchase_intent = $9,
          urgency_level = $10,
          ai_summary = $11,
          ai_insights = $12,
          total_messages = $13,
          response_rate = $14,
          last_analyzed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1 AND conversation_id = $2`,
        [
          businessId,
          conversationId,
          analysis.leadScore,
          analysis.leadStatus,
          analysis.interestLevel,
          JSON.stringify(analysis.behaviorTags),
          analysis.sentiment,
          JSON.stringify(analysis.keyTopics),
          analysis.purchaseIntent,
          analysis.urgencyLevel,
          analysis.aiSummary,
          JSON.stringify(analysis.insights),
          currentMessageCount, // Use actual total count, not limited messages.length
          responseRate.toFixed(2)
        ]
      );
    } else {
      await queryRows(
        `INSERT INTO whatsapp_lead_profiles (
          business_id, conversation_id, customer_id, phone,
          lead_score, lead_status, interest_level, behavior_tags, sentiment,
          key_topics, purchase_intent, urgency_level, ai_summary, ai_insights,
          total_messages, response_rate, last_analyzed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP)`,
        [
          businessId,
          conversationId,
          customerId || null,
          phone,
          analysis.leadScore,
          analysis.leadStatus,
          analysis.interestLevel,
          JSON.stringify(analysis.behaviorTags),
          analysis.sentiment,
          JSON.stringify(analysis.keyTopics),
          analysis.purchaseIntent,
          analysis.urgencyLevel,
          analysis.aiSummary,
          JSON.stringify(analysis.insights),
          currentMessageCount, // Use actual total count, not limited messages.length
          responseRate.toFixed(2)
        ]
      );
    }

    console.log('[CRM] ✅ Lead profile updated:', {
      score: analysis.leadScore,
      status: analysis.leadStatus,
      sentiment: analysis.sentiment
    });
  } catch (error) {
    console.error('[CRM] Error in analyzeAndUpdateLeadProfile:', error);
  }
}
