/**
 * API endpoint to fetch and send messages in live mode (JID-based conversations)
 * This bypasses database storage and works directly with Baileys store
 */

import { NextRequest, NextResponse } from 'next/server';
import { getWhatsAppSocket } from '@/lib/whatsapp';
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { storeOutgoingMessage } from '@/lib/whatsapp-crm';
import { proto, downloadMediaMessage } from '@whiskeysockets/baileys';
import { extractWebMessageInfoTimestampSec, orderResolveMessageTimestamps, normalizeMessage } from '@/lib/baileys-store-helpers';

/**
 * Baileys may index chats by a JID that differs from our DB/URL (e.g. LID, leading country code).
 * Find a store key that matches the same chat as `requestedJid`.
 */
function findMatchingStoreJid(
  storeMessages: Record<string, unknown> | undefined,
  requestedJid: string
): string | null {
  if (!storeMessages || !requestedJid) return null;
  if (storeMessages[requestedJid]) return requestedJid;
  if (requestedJid.endsWith('@g.us')) {
    return storeMessages[requestedJid] ? requestedJid : null;
  }
  const digits = requestedJid.split('@')[0].replace(/\D/g, '');
  if (!digits) return null;
  for (const k of Object.keys(storeMessages)) {
    if (k.endsWith('@g.us')) continue;
    const kd = k.split('@')[0].replace(/\D/g, '');
    if (!kd) continue;
    if (kd === digits) return k;
    if (kd.length >= 10 && digits.length >= 10 && kd.slice(-10) === digits.slice(-10)) {
      return k;
    }
  }
  return null;
}

function getProtoTimestampSec(msg: proto.IWebMessageInfo): number {
  return extractWebMessageInfoTimestampSec(msg);
}

function collectStoreProtoMessages(jidMessages: unknown): proto.IWebMessageInfo[] {
  if (Array.isArray(jidMessages)) {
    return jidMessages;
  }
  if (jidMessages && typeof jidMessages === 'object') {
    const o = jidMessages as { all?: () => proto.IWebMessageInfo[] };
    if (typeof o.all === 'function') {
      return o.all();
    }
    return Object.values(jidMessages) as proto.IWebMessageInfo[];
  }
  return [];
}

/** Single Baileys message → API shape (shared by store pagination and DB+store merge). */
async function transformOneProtoToFrontend(
  sock: { store: { contacts?: Record<string, { name?: string; notify?: string }> } },
  jid: string,
  msg: proto.IWebMessageInfo
): Promise<Record<string, unknown> | null> {
  const key = msg.key;

  if (!key) {
    return null;
  }

  if (!msg.message) {
    return null;
  }
  const message = normalizeMessage(msg.message, 'live:transform') as proto.IMessage | null | undefined;
  if (!message) {
    return null;
  }

  let messageText = '';
  let messageType = 'text';
  let quotedMessage: any = null;

  if (message?.conversation) {
    messageText = message.conversation;
    messageType = 'text';
  } else if (message?.extendedTextMessage?.text) {
    messageText = message.extendedTextMessage.text;
    messageType = 'text';
    const contextInfo = message.extendedTextMessage.contextInfo;
    if (contextInfo?.quotedMessage) {
      const quoted = normalizeMessage(contextInfo.quotedMessage, 'live:quoted') || contextInfo.quotedMessage;
      let quotedText = '';
      let quotedType = 'text';
      if (quoted.conversation) {
        quotedText = quoted.conversation;
      } else if (quoted.extendedTextMessage?.text) {
        quotedText = quoted.extendedTextMessage.text;
      } else if (quoted.imageMessage) {
        quotedText = quoted.imageMessage.caption || 'Photo';
        quotedType = 'image';
      } else if (quoted.videoMessage) {
        quotedText = quoted.videoMessage.caption || 'Video';
        quotedType = 'video';
      } else if (quoted.audioMessage) {
        quotedText = 'Audio';
        quotedType = 'audio';
      } else if (quoted.documentMessage) {
        quotedText = quoted.documentMessage.fileName || 'Document';
        quotedType = 'document';
      }
      quotedMessage = {
        text: quotedText,
        type: quotedType,
        sender: contextInfo.participant || contextInfo.remoteJid || 'Unknown',
        messageId: contextInfo.stanzaId
      };
    }
  } else if (message?.imageMessage) {
    messageText = message.imageMessage.caption || '📷 Photo';
    messageType = 'image';
  } else if (message?.videoMessage) {
    messageText = message.videoMessage.caption || '🎥 Video';
    messageType = 'video';
  } else if (message?.audioMessage) {
    messageText = '🎵 Audio';
    messageType = 'audio';
  } else if (message?.documentMessage) {
    messageText = message.documentMessage?.fileName || '📄 Document';
    messageType = 'document';
  } else if (message?.contactMessage) {
    messageText = '👤 Contact';
    messageType = 'contact';
  } else if (message?.locationMessage) {
    messageText = '📍 Location';
    messageType = 'location';
  } else if (message?.stickerMessage) {
    messageText = '🎭 Sticker';
    messageType = 'sticker';
  } else {
    messageText = '📎 Media';
    messageType = 'media';
  }

  let senderName: string | null = null;
  let senderNumber: string | null = null;
  if (jid.endsWith('@g.us') && key?.participant) {
    senderNumber = key.participant.split('@')[0];
    try {
      const contact = sock.store.contacts?.[key.participant];
      if (contact) {
        senderName = contact.name || contact.notify || null;
      }
    } catch {
      // ignore
    }
  }

  const ts = extractWebMessageInfoTimestampSec(msg);
  // Never use Date.now() here — it makes every message in a batch the same "today" (breaks date headers and order).
  const createdAt = ts > 0 ? new Date(ts * 1000).toISOString() : new Date(0).toISOString();

  let status = 'sent';
  if (key?.fromMe) {
    status = msg.status ? String(msg.status) : 'sent';
  }

  const fromNumber = key?.fromMe ? null : (key?.participant || key?.remoteJid || '').split('@')[0];
  const toNumber = key?.fromMe ? (key?.remoteJid || '').split('@')[0] : null;

  let mediaUrl: string | null = null;
  try {
    if (message?.imageMessage || message?.videoMessage || message?.audioMessage || message?.documentMessage || message?.stickerMessage) {
      const buffer = await downloadMediaMessage(msg as any, 'buffer', {});
      if (buffer && buffer.length > 0) {
        const base64 = buffer.toString('base64');
        let mimeType = 'application/octet-stream';
        if (message?.imageMessage) {
          mimeType = message.imageMessage.mimetype || 'image/jpeg';
        } else if (message?.videoMessage) {
          mimeType = message.videoMessage.mimetype || 'video/mp4';
        } else if (message?.audioMessage) {
          mimeType = message.audioMessage.mimetype || 'audio/ogg';
        } else if (message?.documentMessage) {
          mimeType = message.documentMessage.mimetype || 'application/pdf';
        } else if (message?.stickerMessage) {
          mimeType = message.stickerMessage.mimetype || 'image/webp';
        }
        mediaUrl = `data:${mimeType};base64,${base64}`;
      }
    }
  } catch (mediaError) {
    console.error(`[Live Messages] ⚠️ Failed to download media for message ${key?.id}:`, mediaError);
  }

  return {
    id: key?.id || '',
    message_id: key?.id || '',
    from_number: fromNumber || '',
    to_number: toNumber || '',
    message_text: messageText,
    message_type: messageType,
    direction: key?.fromMe ? 'outgoing' : 'incoming',
    status: status,
    created_at: createdAt,
    sender_name: senderName,
    sender_number: senderNumber,
    media_url: mediaUrl,
    buttons: null,
    quoted_message: quotedMessage,
    source: 'baileys'
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { jid: string } }
) {
  try {
    const jid = decodeURIComponent(params.jid);
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
    const rawOff = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Math.max(0, Number.isFinite(rawOff) ? rawOff : 0);

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

    // Get active socket
    const session = await getWhatsAppSocket(businessId);
    
    // DEBUG: Log session state
    console.log('[Live Messages] Session check:', {
      jid,
      hasSession: !!session,
      status: session?.status,
      hasSocket: !!session?.socket,
      socketValid: session?.socket ? !session.socket.ws?.isClosed : false
    });
    
    if (!session || session.status !== 'connected' || !session.socket) {
      return NextResponse.json(
        { 
          error: 'WhatsApp is not connected. Please connect first.',
          debug: {
            hasSession: !!session,
            status: session?.status,
            hasSocket: !!session?.socket
          }
        },
        { status: 503 }
      );
    }

    const sock = session.socket;
    
    // Access messages from store with detailed diagnostics
    console.log('[Live Messages] Checking store availability:', {
      jid,
      businessId,
      hasSocket: !!sock,
      hasStore: !!sock.store,
      hasMessagesStore: !!sock.store?.messages,
      storeType: typeof sock.store,
      messagesStoreType: typeof sock.store?.messages
    });
    
    if (!sock.store) {
      console.error('[Live Messages] ❌ Store not available:', {
        jid,
        businessId,
        hasSocket: !!sock,
        storeExists: !!sock.store
      });
      return NextResponse.json(
        { error: 'Message store not available. Please wait for connection to fully initialize.' },
        { status: 503 }
      );
    }
    
    // Check if messages store exists - it might be an empty object, which is valid
    if (sock.store.messages === undefined || sock.store.messages === null) {
      console.error('[Live Messages] ❌ Messages store not available:', {
        jid,
        businessId,
        hasStore: !!sock.store,
        hasMessages: !!sock.store.messages,
        storeKeys: Object.keys(sock.store || {}),
        storeStructure: {
          chats: !!sock.store.chats,
          contacts: !!sock.store.contacts,
          messages: !!sock.store.messages
        }
      });
      return NextResponse.json(
        { error: 'Message store not available. Please wait for connection to fully initialize.' },
        { status: 503 }
      );
    }
    
    // Store exists - log what we have
    const messageStoreKeys = Object.keys(sock.store.messages || {});
    console.log('[Live Messages] ✅ Store available:', {
      jid,
      totalJidsInStore: messageStoreKeys.length,
      hasThisJid: jid in (sock.store.messages || {}),
      sampleJids: messageStoreKeys.slice(0, 5)
    });

    // Default: WhatsApp/Baileys store is the source of truth for the thread (like WhatsApp Web).
    // Set WHATSAPP_LIVE_MESSAGES_DB_FALLBACK=true to restore the old DB-first / DB-merge behavior.
    const useDbFallback =
      process.env.WHATSAPP_LIVE_MESSAGES_DB_FALLBACK === 'true' ||
      process.env.WHATSAPP_LIVE_MESSAGES_DB_FALLBACK === '1';

    // Get messages for this JID with detailed logging
    let messages: proto.IWebMessageInfo[] = [];
    try {
      let resolvedStoreJid = findMatchingStoreJid(sock.store.messages, jid) ?? jid;
      let jidMessages = sock.store.messages[resolvedStoreJid];
      
      console.log('[Live Messages] Accessing messages for JID:', {
        jid,
        resolvedStoreJid: resolvedStoreJid !== jid ? resolvedStoreJid : undefined,
        hasJidMessages: !!jidMessages,
        jidMessagesType: typeof jidMessages,
        isArray: Array.isArray(jidMessages),
        storeMessageKeys: Object.keys(sock.store.messages).slice(0, 10), // First 10 JIDs for debugging
        totalJidsInStore: Object.keys(sock.store.messages).length
      });
      
      let storeHasMessages = jidMessages && (
        (Array.isArray(jidMessages) && jidMessages.length > 0) ||
        (typeof jidMessages === 'object' && !Array.isArray(jidMessages) && Object.keys(jidMessages).length > 0)
      );

      if (!useDbFallback && offset === 0 && !storeHasMessages) {
        try {
          const { bootstrapChatHistoryFromWhatsApp } = await import('@/lib/whatsapp');
          const boot = await bootstrapChatHistoryFromWhatsApp(businessId, jid);
          console.log('[Live Messages] 🔄 bootstrapChatHistoryFromWhatsApp:', boot);
          resolvedStoreJid = findMatchingStoreJid(sock.store.messages, jid) ?? jid;
          jidMessages = sock.store.messages[resolvedStoreJid];
          storeHasMessages = jidMessages && (
            (Array.isArray(jidMessages) && jidMessages.length > 0) ||
            (typeof jidMessages === 'object' && !Array.isArray(jidMessages) && Object.keys(jidMessages).length > 0)
          );
        } catch (bootErr) {
          console.warn('[Live Messages] bootstrap history failed (non-fatal):', bootErr);
        }
      }
      
      // With DB fallback: use Postgres for initial load or when the store is empty (legacy).
      // Without fallback: never load the thread body from whatsapp_conversation_messages.
      const shouldUseDatabase = useDbFallback && (offset === 0 || !storeHasMessages);
      
      if (shouldUseDatabase) {
        console.log('[Live Messages] 📚 Using database for message history', {
          reason: offset === 0 ? 'initial_load' : 'store_empty_or_incomplete',
          jid,
          offset,
          storeHasMessages
        });
        
        try {
          const { getPool } = await import('@/lib/db');
          const pool = getPool();
          
          // Find conversation ID from JID - improved matching
          const jidPhoneOnly = jid.split('@')[0].replace(/\D/g, ''); // Extract digits only
          const isGroup = jid.endsWith('@g.us');
          
          const convQuery = await pool.query(
            isGroup 
              ? `SELECT id, conversation_id, from_number, is_group
                 FROM whatsapp_conversations
                 WHERE business_id = $1 
                   AND conversation_id = $2
                   AND is_group = true
                 LIMIT 1`
              : `SELECT id, conversation_id, from_number, is_group
                 FROM whatsapp_conversations
                 WHERE business_id = $1 
                   AND is_group = false
                   AND (
                     conversation_id = $2 
                     OR from_number = $2
                     OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $3
                     OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $3
                     OR conversation_id LIKE $4
                     OR from_number LIKE $4
                   )
                 LIMIT 1`,
            isGroup 
              ? [businessId, jid]
              : [businessId, jid, jidPhoneOnly, `%${jidPhoneOnly}%`]
          );
          
          if (convQuery.rows.length === 0) {
            console.warn('[Live Messages] No conversation found in database for JID:', { jid, jidPhoneOnly, isGroup, businessId });
            if (offset > 0 && !storeHasMessages) {
              return NextResponse.json({ messages: [], total: 0, has_more: false });
            }
            // Initial load: list may show last_message from sync while DB row/JID differ — try Baileys store below
          } else {
          
          const conversation = convQuery.rows[0];
          
          // Fetch total count first to determine has_more accurately
          const countQuery = await pool.query(
            `SELECT COUNT(*) as total
             FROM whatsapp_conversation_messages
             WHERE conversation_id = $1 AND business_id = $2`,
            [conversation.id, businessId]
          );
          const totalCount = parseInt(countQuery.rows[0]?.total || '0');
          
          let msgQuery;
          let hasMore = false;
          
          if (offset === 0) {
            // Initial load: Get the most recent messages (for WhatsApp Web, show recent at bottom)
            // We'll get the last N messages ordered ASC (oldest to newest)
            msgQuery = await pool.query(
              `SELECT * FROM (
                 SELECT 
                   m.id, 
                   m.message_id, 
                   m.conversation_id, 
                   m.message_text, 
                   m.message_type,
                   m.media_url, 
                   m.direction, 
                   m.status, 
                   m.created_at,
                   m.source_timestamp,
                   m.from_number,
                   m.to_number,
                   m.sender_name,
                   ${isGroup ? 'm.from_number as sender_number' : 'NULL as sender_number'}
                 FROM whatsapp_conversation_messages m
                 WHERE m.conversation_id = $1 AND m.business_id = $2
                 ORDER BY m.created_at DESC, m.message_id DESC
                 LIMIT $3
               ) AS recent_messages
               ORDER BY created_at ASC, message_id ASC`,
              [conversation.id, businessId, limit]
            );
            // More rows exist in DB after this page
            hasMore = totalCount > limit;
            // If every DB row fit in the first page, scrolling may still load older
            // history from the linked session or WhatsApp (not persisted in our DB).
            if (totalCount > 0 && totalCount <= limit) {
              hasMore = true;
            }
          } else {
            // Scrolling up: Get older messages (before current oldest)
            // offset represents how many messages we already have, so we want messages before that
            msgQuery = await pool.query(
              `SELECT 
                 m.id, 
                 m.message_id, 
                 m.conversation_id, 
                 m.message_text, 
                 m.message_type,
                 m.media_url, 
                 m.direction, 
                 m.status, 
                 m.created_at,
                 m.source_timestamp,
                 m.from_number,
                 m.to_number,
                 m.sender_name,
                 ${isGroup ? 'm.from_number as sender_number' : 'NULL as sender_number'}
               FROM whatsapp_conversation_messages m
               WHERE m.conversation_id = $1 AND m.business_id = $2
               ORDER BY m.created_at ASC, m.message_id ASC
               LIMIT $3 OFFSET $4`,
              [conversation.id, businessId, limit, offset]
            );
            // If we got a full batch and there are more before this, has_more = true
            hasMore = msgQuery.rows.length === limit && (offset + msgQuery.rows.length) < totalCount;
          }
          
          console.log('[Live Messages] ✅ Fetched from database:', {
            jid,
            conversationDbId: conversation.id,
            conversationJid: conversation.conversation_id,
            messageCount: msgQuery.rows.length,
            totalCount,
            limit,
            offset,
            hasMore,
            isInitialLoad: offset === 0,
            directions: msgQuery.rows.map((r: any) => r.direction),
            incomingCount: msgQuery.rows.filter((r: any) => r.direction === 'incoming').length,
            outgoingCount: msgQuery.rows.filter((r: any) => r.direction === 'outgoing').length,
            sampleMessages: msgQuery.rows.slice(0, 3).map((r: any) => ({
              direction: r.direction,
              text: r.message_text?.substring(0, 30),
              created_at: r.created_at
            }))
          });
          
          // Transform to frontend format
          const dbMessages = msgQuery.rows.map((row: any) => ({
            id: row.message_id || row.id,
            conversation_id: row.conversation_id,
            message_text: row.message_text,
            message_type: row.message_type,
            media_url: row.media_url,
            direction: row.direction,
            status: row.status,
            created_at: row.created_at,
            source_timestamp: row.source_timestamp,
            from_number: row.from_number,
            to_number: row.to_number,
            sender_name: row.sender_name || null,
            sender_number: row.sender_number || null,
            source: 'database'
          }));
          
          if (dbMessages.length > 0) {
            // 1) Patch DB `created_at` from Baileys protos (fixes rows ingested with sync-time / CURRENT_TIMESTAMP).
            // 2) Merge store messages in the *recent tail* that are missing from DB by id. Do NOT use
            //    "newer than max(DB created_at)" — corrupt DB times can be *ahead* of real last-night
            //    messages, which would hide them.
            let toReturn: typeof dbMessages = dbMessages;
            if (storeHasMessages && jidMessages) {
              const storeProtos = collectStoreProtoMessages(jidMessages);
              storeProtos.sort((a, b) => getProtoTimestampSec(a) - getProtoTimestampSec(b));
              const protoById = new Map<string, proto.IWebMessageInfo>();
              for (const p of storeProtos) {
                if (p.key?.id) protoById.set(String(p.key.id), p);
              }
              toReturn = dbMessages.map((m) => {
                const p = protoById.get(String(m.id));
                if (!p) return m;
                const s = getProtoTimestampSec(p);
                if (s > 0) {
                  return { ...m, created_at: new Date(s * 1000).toISOString() };
                }
                return m;
              });

              if (offset === 0) {
                const seen = new Set(toReturn.map((m) => String(m.id)));
                const tailN = Math.min(storeProtos.length, Math.max(limit * 3, 150));
                const missing = storeProtos
                  .slice(-tailN)
                  .filter((m) => m.key && m.key.id && !seen.has(String(m.key.id)));
                if (missing.length > 0) {
                  const fromStore = (
                    await Promise.all(
                      missing.map((m) => transformOneProtoToFrontend(sock, jid, m))
                    )
                  ).filter((x): x is Record<string, unknown> => x !== null);
                  if (fromStore.length > 0) {
                    const merged = [...toReturn, ...fromStore].sort(
                      (a, b) =>
                        new Date(a.created_at as string).getTime() -
                        new Date(b.created_at as string).getTime()
                    );
                    const windowed = merged.length > limit ? merged.slice(merged.length - limit) : merged;
                    console.log('[Live Messages] Merged store tail into DB (by id, not by max created_at):', {
                      dbBatch: toReturn.length,
                      added: fromStore.length,
                      windowed: windowed.length
                    });
                    return NextResponse.json({
                      messages: windowed,
                      total: totalCount,
                      has_more: hasMore,
                      hybrid: true,
                      note: 'Database history plus Baileys store: patched times from device protos and added missing recent messages by id.'
                    });
                  }
                }
              }
            }
            return NextResponse.json({
              messages: toReturn,
              total: totalCount,
              has_more: hasMore,
              hybrid: true,
              note: 'Showing message history from database (timestamps may be patched from the linked session when available).'
            });
          }
          // DB had no messages for this page (e.g. offset past DB rows) — do not return
          // here; fall through to Baileys + fetchMessageHistory so scroll-up can load
          // older messages from the linked WhatsApp session.
          if (offset > 0 && !storeHasMessages) {
            return NextResponse.json({ messages: [], total: totalCount, has_more: false });
          }
          if (offset === 0 && !storeHasMessages) {
            return NextResponse.json({ messages: [], total: totalCount, has_more: false });
          }
          console.log('[Live Messages] 📭 No rows in DB for this chat; using Baileys store for initial load', {
            jid,
            totalCount,
            resolvedStoreJid: resolvedStoreJid !== jid ? resolvedStoreJid : undefined
          });
          }
        } catch (dbError) {
          console.error('[Live Messages] ❌ Database fallback failed:', dbError);
          if (offset > 0 && !storeHasMessages) {
            return NextResponse.json({ messages: [], total: 0, has_more: false });
          }
          if (offset === 0 && !storeHasMessages) {
            return NextResponse.json({ messages: [], total: 0, has_more: false });
          }
        }
      }
      
      if (Array.isArray(jidMessages)) {
        messages = jidMessages;
      } else if (jidMessages && typeof jidMessages === 'object') {
        // If it's a KeyedDB-like structure, try to get all messages
        if (typeof jidMessages.all === 'function') {
          messages = jidMessages.all();
        } else {
          messages = Object.values(jidMessages);
        }
      }
      messages.sort((a, b) => getProtoTimestampSec(a) - getProtoTimestampSec(b));
      
      console.log('[Live Messages] Retrieved messages:', {
        jid,
        messageCount: messages.length,
        firstMessageTimestamp: messages[0]?.messageTimestamp,
        lastMessageTimestamp: messages[messages.length - 1]?.messageTimestamp
      });
    } catch (error: any) {
      console.error('[Live Messages] Error accessing messages:', {
        error: error.message,
        stack: error.stack,
        jid,
        businessId
      });
      return NextResponse.json(
        { error: `Failed to access messages: ${error.message}` },
        { status: 500 }
      );
    }
    
    // Check if we need to fetch more history from WhatsApp
    // This happens when requesting older messages (offset > 0) and store doesn't have enough
    const totalMessages = messages.length;
    const neededMessages = offset + limit;
    
    if (offset > 0 && totalMessages < neededMessages) {
      console.log('[Live Messages] 🔄 Store has insufficient history. Will try WhatsApp fetch, then database fallback:', {
        totalInStore: totalMessages,
        neededTotal: neededMessages,
        offset,
        limit
      });
      
      // Try fetching from WhatsApp first (only if we have at least 1 message as reference)
      if (totalMessages > 0) {
        try {
          const { fetchOlderMessagesFromWhatsApp } = await import('@/lib/whatsapp');
          const fetchResult = await fetchOlderMessagesFromWhatsApp(businessId, jid, 50);
          
          if (fetchResult.success && fetchResult.messages && fetchResult.messages.length > totalMessages) {
            console.log('[Live Messages] ✅ Successfully fetched older messages from WhatsApp');
            messages = fetchResult.messages;
            console.log('[Live Messages] 📊 Updated message count:', messages.length);
          } else {
            console.log('[Live Messages] ⚠️ WhatsApp fetch did not return more messages, falling back to database');
          }
        } catch (fetchError) {
          console.error('[Live Messages] ❌ Error fetching from WhatsApp, falling back to database:', fetchError);
        }
      }
      
      if (useDbFallback && messages.length < neededMessages) {
        console.log('[Live Messages] 📦 Falling back to database for history');
        try {
          const { getPool } = await import('@/lib/db');
          const pool = getPool();
          
          // Find conversation ID - improved matching
          const jidPhoneOnly = jid.split('@')[0].replace(/\D/g, '');
          const isGroup = jid.endsWith('@g.us');
          
          const convQuery = await pool.query(
            isGroup
              ? `SELECT id FROM whatsapp_conversations 
                 WHERE business_id = $1 AND conversation_id = $2 AND is_group = true
                 LIMIT 1`
              : `SELECT id FROM whatsapp_conversations 
                 WHERE business_id = $1 
                   AND is_group = false
                   AND (
                     conversation_id = $2 
                     OR from_number = $2
                     OR REGEXP_REPLACE(conversation_id, '[^0-9]', '', 'g') = $3
                     OR REGEXP_REPLACE(from_number, '[^0-9]', '', 'g') = $3
                   )
                 LIMIT 1`,
            isGroup ? [businessId, jid] : [businessId, jid, jidPhoneOnly]
          );
          
          if (convQuery.rows.length > 0) {
            // Get total count for has_more calculation
            const countQuery = await pool.query(
              `SELECT COUNT(*) as total
               FROM whatsapp_conversation_messages
               WHERE conversation_id = $1 AND business_id = $2`,
              [convQuery.rows[0].id, businessId]
            );
            const totalCount = parseInt(countQuery.rows[0]?.total || '0');
            
            const dbMessages = await pool.query(`
              SELECT 
                m.id, 
                m.message_id, 
                m.message_text, 
                m.message_type, 
                m.media_url, 
                m.direction, 
                m.status, 
                m.created_at,
                m.source_timestamp,
                m.from_number,
                m.to_number,
                m.sender_name,
                ${isGroup ? 'm.from_number as sender_number' : 'NULL as sender_number'}
              FROM whatsapp_conversation_messages m
              WHERE m.conversation_id = $1 AND m.business_id = $2
              ORDER BY m.created_at ASC, m.message_id ASC
              LIMIT $3 OFFSET $4`,
              [convQuery.rows[0].id, businessId, limit, offset]
            );
            
            console.log(`[Live Messages] ✅ Fetched ${dbMessages.rows.length} messages from database (offset: ${offset})`, {
              totalCount,
              fetchedCount: dbMessages.rows.length,
              hasMore: (offset + dbMessages.rows.length) < totalCount,
              directions: dbMessages.rows.map((r: any) => r.direction)
            });
            
            // Transform database messages (already in ASC order - oldest first)
            const dbMsgs = dbMessages.rows.map((row: any) => ({
              id: row.message_id || row.id,
              conversation_id: convQuery.rows[0].id,
              message_text: row.message_text,
              message_type: row.message_type,
              media_url: row.media_url,
              direction: row.direction,
              status: row.status,
              created_at: row.created_at,
              source_timestamp: row.source_timestamp,
              from_number: row.from_number,
              to_number: row.to_number,
              sender_name: row.sender_name || null,
              sender_number: row.sender_number || null,
              source: 'database'
            }));
            
            const hasMore = (offset + dbMessages.rows.length) < totalCount;
            
            return NextResponse.json({
              messages: dbMsgs, // Already in chronological order (oldest→newest)
              total: totalCount,
              has_more: hasMore,
              source: 'database',
              note: 'Loaded from database history'
            });
          }
        } catch (dbError) {
          console.error('[Live Messages] ❌ Database fallback failed:', dbError);
        }
      }
    }
    
    // Pagination logic: 
    // - offset=0, limit=50 → get last 50 messages (most recent)
    // - offset=50, limit=50 → get 50 messages before that (older)
    const finalTotalMessages = messages.length;
    const startIndex = Math.max(0, finalTotalMessages - offset - limit);
    const endIndex = finalTotalMessages - offset;
    
    console.log('[Live Messages] Pagination:', {
      totalMessages: finalTotalMessages,
      offset,
      limit,
      startIndex,
      endIndex,
      willFetch: endIndex - startIndex
    });
    
    // Transform messages to match your frontend format (keep proto row aligned for timestamp fill)
    const protoSlice = messages.slice(startIndex, endIndex);
    const paired = await Promise.all(
      protoSlice.map(async (msg: proto.IWebMessageInfo) => ({
        p: msg,
        row: await transformOneProtoToFrontend(sock, jid, msg)
      }))
    );
    const ok = paired.filter(
      (x): x is { p: proto.IWebMessageInfo; row: NonNullable<(typeof paired)[0]['row']> } => x.row !== null
    );
    const transformedMessages = ok.map((x) => x.row);
    orderResolveMessageTimestamps(
      ok.map((x) => x.p),
      transformedMessages as { created_at: string }[]
    );
    
    // Baileys store already has messages in chronological order (oldest→newest)
    // No need to reverse - send as-is for WhatsApp Web behavior
    
    // More older messages exist in the in-memory array iff the slice did not start at 0
    const hasMore = startIndex > 0;
    
    console.log('[Live Messages] Response:', {
      returnedCount: transformedMessages.length,
      totalMessages: finalTotalMessages,
      hasMore,
      offset,
      limit,
      logic: hasMore ? 'older-available-in-store' : 'no-older-in-store'
    });
    
    return NextResponse.json({ 
      messages: transformedMessages, // Already in correct order (oldest→newest)
      total: finalTotalMessages,
      has_more: hasMore
    });
  } catch (error: any) {
    console.error('[Live Messages] Error fetching messages:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch live messages' 
    }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { jid: string } }
) {
  try {
    const jid = decodeURIComponent(params.jid);
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
    console.log('[Live Messages] 📤 Attempting to send message:', {
      jid,
      businessId,
      messageText: message_text,
      messageType: msgType,
      hasMedia: !!media,
      hasButtons: !!buttons
    });

    let messageId: string | undefined;
    try {
      const result = await sendWhatsAppMessage(
        businessId,
        jid, // Use JID directly
        message_text || '',
        media,
        msgType as 'text' | 'image' | 'button' | 'document',
        buttons,
        footer
      );
      messageId = typeof result === 'string' ? result : undefined;
      
      console.log('[Live Messages] ✅ Message sent successfully:', {
        jid,
        messageId,
        messageText: message_text
      });
    } catch (sendError: any) {
      console.error('[Live Messages] ❌ Error sending WhatsApp message:', {
        jid,
        error: sendError.message,
        stack: sendError.stack,
        businessId
      });
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

    const skipMirror =
      process.env.WHATSAPP_SKIP_CONVERSATION_MESSAGE_MIRROR === 'true' ||
      process.env.WHATSAPP_SKIP_CONVERSATION_MESSAGE_MIRROR === '1';

    if (!skipMirror && messageId) {
      try {
        const { getPool } = await import('@/lib/db');
        const pool = getPool();
        const convQuery = await pool.query(
          `SELECT id FROM whatsapp_conversations 
           WHERE business_id = $1 AND conversation_id = $2
           LIMIT 1`,
          [businessId, jid]
        );
        if (convQuery.rows.length > 0) {
          const conversationDbId = convQuery.rows[0].id as string;
          const liveNormSec = Math.floor(Date.now() / 1000);
          await storeOutgoingMessage(
            businessId,
            conversationDbId,
            jid,
            message_text || '',
            messageId,
            msgType,
            media_url || undefined,
            undefined,
            liveNormSec,
            null
          );
          console.log('[Live Messages] ✅ Outgoing message persisted + SSE emit (CRM path)');
        }
      } catch (dbError) {
        console.error('[Live Messages] ⚠️ storeOutgoingMessage failed (non-critical):', dbError);
      }
    }

    return NextResponse.json({ 
      success: true, 
      message_id: messageId,
      message: {
        id: messageId,
        message_id: messageId,
        message_text: message_text || '',
        message_type: msgType,
        direction: 'outgoing',
        status: 'sent',
        created_at: new Date().toISOString(),
      }
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Live Messages] Error sending message:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
